# Plan de conception — Pricing Engine « Retail + Matrice »

**Version :** 1.0 (brouillon d’architecture)  
**Objectif :** Définir l’architecture définitive du moteur de prix : prix neuf stockés dans Supabase, décote par matrice catégorie × état, exposition via l’API Next.js — **sans** scraping du marché de l’occasion en temps réel sur la requête utilisateur.

---

## 1. Schéma de base de données (Supabase)

### 1.1 Rôle de la table

La table sert de **référentiel prix neuf** (PIM minimal ou sous-ensemble « pricing »). Elle est la **source de vérité** pour le « Prix public conseillé / MSRP » utilisé dans la formule de rachat. Les mises à jour sont **asynchrones** (pipeline d’acquisition), jamais bloquantes sur `/api/estimate`.

### 1.2 Nom et contraintes

- **Nom proposé :** `catalog_prices`  
- **Schéma :** `public` (ou schéma dédié `pim` si vous séparez les domaines plus tard).

### 1.3 Colonnes

| Colonne | Niveau | Description |
|--------|--------|-------------|
| `id` | `uuid`, PK, défaut `gen_random_uuid()` | Identifiant stable d’une ligne produit « marque + modèle + catégorie ». |
| `brand` | `text`, **NOT NULL** | Libellé canonique afficheur (ex.: `Shark`). |
| `model` | `text`, **NOT NULL** | Libellé canonique (ex.: `D-Skwal 3`). |
| `category` | `text`, **NOT NULL**, contrôle par CHECK ou enum applicative | Valeurs alignées sur le formulaire : `casque`, `blouson`, `gants`, `bottes`. |
| `retail_price` | `numeric(10,2)`, **NOT NULL**, `> 0` | Prix neuf / PPC en EUR (ou devise explicitée). |
| `currency` | `text`, **NOT NULL**, défaut `'EUR'` | Pour évolution multi-devise sans migration brutale. |
| `sku` | `text`, nullable, UNIQUE partiel | Référence fabricant / EAN si disponible — facilite dédoublonnage et imports. |
| `source` | `text`, nullable | Origine de la donnée (`import_csv`, `partenaire_x`, etc.) — audit. |
| `source_ref` | `text`, nullable | URL ou identifiant métier opaque. |
| `is_active` | `boolean`, **NOT NULL**, défaut `true` | Permet de retirer un article du matching sans supprimer l’historique. |
| `created_at` | `timestamptz`, **NOT NULL**, défaut `now()` | |
| `updated_at` | `timestamptz`, **NOT NULL**, défaut `now()` | Mis à jour par trigger ou par le pipeline d’import. |

### 1.4 Index et intégrité

- Index composite recommandé : `(category, brand)` pour les requêtes filtrées par catégorie puis marque.
- Index ou **expression index** sur champs **normalisés** (voir section 4) : `(category, normalized_brand, normalized_model)` si vous ajoutez des colonnes dérivées, ou index GIN `pg_trgm` sur `brand` / `model` pour la recherche floue.
- **Contrainte d’unicité métier** (à valider selon vos règles) : par ex. `UNIQUE (category, normalized_brand, normalized_model)` une fois la normalisation définie, pour éviter les doublons après import.

### 1.5 Évolution possible (hors périmètre MVP)

- Table `price_history` (snapshots `retail_price`, `valid_from`) pour audit et A/B sur la matrice.
- Table `matrix_version` pour tracer quelle version des coefficients a servi au calcul (conformité / litiges).

---

## 2. Matrice mathématique (algorithme e-commerce)

### 2.1 Principe

Le **prix de référence** est le `retail_price` issu de Supabase. La **valeur résiduelle estimée** avant marge plateforme est obtenue en appliquant deux coefficients multiplicatifs :

1. **Coefficient catégorie** `α_cat` : rend compte de la dépréciation « typique » par type d’équipement (liquidité, obsolescence, saisonnalité).
2. **Coefficient état** `α_etat` : rend compte de l’usure / de la « distance » au neuf déclarée par le vendeur.

Ensuite s’appliquent la **commission plateforme** (taux fixe sur le montant ainsi obtenu) et les **frais logistiques fixes**, conformément à la politique commerciale déjà posée dans le produit.

### 2.2 Coefficients par catégorie (exemple à valider métier)

Ces valeurs sont **indicatives** ; elles doivent être validées par l’équipe produit / finance et pourront être externalisées en table `depreciation_matrix` (versionnée) plutôt qu’en dur dans le code.

| Catégorie | Coefficient `α_cat` | Commentaire |
|-----------|---------------------|-------------|
| Casque | 0,62 | Forte sensibilité à l’âge, normes, traumatisme perçu du « casque d’occasion ». |
| Blouson | 0,72 | Dépréciation un peu plus lente, stylistique / taille. |
| Gants | 0,68 | Article plus petit, cycles de remplacement plus fréquents. |
| Bottes | 0,70 | Entre blouson et casque sur la perception valeur résiduelle. |

*Remarque :* la somme ou l’ordre relatif doit refléter votre **positionnement** ; l’important est d’avoir une **règle documentée** et **reproductible**.

### 2.3 Coefficients par état

Alignés sur les options du formulaire actuel :

| État (identifiant) | Libellé | Coefficient `α_etat` |
|--------------------|---------|----------------------|
| `neuf-etiquette` | Neuf avec étiquette | 1,00 |
| `tres-bon` | Très bon état | 0,85 |
| `bon` | Bon état | 0,70 |

### 2.4 Formule du prix net vendeur

**Étape 1 — Base après décote « retail × catégorie × état » :**

\[
B = \text{retail\_price} \times \alpha_{\text{cat}} \times \alpha_{\text{etat}}
\]

**Étape 2 — Application marge plateforme et frais fixes** (cohérent avec la logique actuelle « −30 % commission » puis « −10 € ») :

\[
\text{Net vendeur} = \max\left(0,\ \mathrm{arrondi}\bigl( B \times (1 - 0{,}30) - 10 \bigr)\right)
\]

- **Arrondi :** entier le plus proche en EUR (ou règle banque : à préciser avec la compta).
- **Plancher :** si le montant devient négatif après déduction, retourner `0` ou une politique « offre refusée / seuil minimum » (décision produit).

### 2.5 Exemple fictif — Shark D-Skwal 3

- **Prix neuf (`retail_price`) :** 200 €  
- **Catégorie :** casque → `α_cat = 0,62`  
- **État :** Très bon état → `α_etat = 0,85`  

**Calcul :**

1. \(B = 200 \times 0{,}62 \times 0{,}85 = 200 \times 0{,}527 = 105{,}40\) €  
2. Après commission 30 % : \(105{,}40 \times 0{,}7 = 73{,}78\) €  
3. Après frais fixes : \(73{,}78 - 10 = 63{,}78\) € → **arrondi : 64 €** net vendeur (si arrondi au plus proche entier).

Ce chiffre sert d’**illustration** ; le MCP/ERP réel fixera le `retail_price` en base.

---

## 3. Architecture du « scraper » et acquisition des données

### 3.1 Positionnement

Le terme « scraper » est ici **large** : il désigne tout **pipeline d’alimentation** du référentiel `catalog_prices`. L’exigence produit est : **fiabilité** et **performance** ; la collecte ne doit **pas** se faire sur le chemin critique de la requête HTTP utilisateur.

### 3.2 Stratégies recommandées (par ordre de préférence opérationnelle)

1. **Flux structurés (idéal)** : fichiers CSV / API fournisseur / base distante synchronisée — minimal risque juridique, meilleure qualité.  
2. **Scraping ciblé et encadré** : uniquement si les **CGU** et le **cadre légal** le permettent ; en général en **batch** nocturne, avec rate limiting et traçabilité `source` / `source_ref`.  
3. **Saisie / modération manuelle** pour les références rares, complément des flux automatiques.

### 3.3 Choix d’implémentation : script autonome vs Vercel Cron + Route Handler

| Critère | Script Node/TS (ou worker) autonome | Vercel Cron + API Route Next.js |
|--------|-------------------------------------|----------------------------------|
| **Durée d’exécution** | Adapté aux jobs **longs** (Puppeteer lourd, gros imports). | Limites strictes (timeout serverless) ; risqué pour scraping volumineux. |
| **Puppeteer / Chromium** | Exécution sur machine dédiée, conteneur, ou service type Browserless — **recommandé** pour le rendu JS. | Possible mais fragile (taille bundle, cold start, limites mémoire). |
| **Secrets & réseau** | Variables d’environnement sur le worker ; accès DB direct. | Idem, mais attention aux quotas et logs. |
| **Simplicité ops** | Nécessite hébergement du job (GitHub Actions, VPS, Cloud Run, etc.). | Très simple si le job est **court** (ex. appel à une API tierce + upsert Supabase). |
| **Cheerio (HTML statique)** | Excellent dans un script CLI lancé en Cron externe. | Acceptable sur Vercel si le volume est faible et le temps d’exécution très court. |

**Recommandation :**

- Pour un **Pricing Engine définitif** avec imports potentiellement lourds ou navigateur réel : **pipeline autonome** (Node/TypeScript ou Python) déclenché par **cron système**, **GitHub Actions**, **Cloud Scheduler**, ou worker sur votre infra — qui écrit dans Supabase via le **service role** (clé sécurisée, jamais exposée au client).
- Utiliser **Vercel Cron + petite Route Handler** uniquement pour des tâches **légères** : webhook fournisseur, refresh d’une API JSON officielle, ou **orchestration** qui enqueue un job ailleurs — pas comme unique stratégie si le scraping DOM est central et long.

**Synthèse :** séparer **ingestion** (batch, scalable) et **estimation** (requête rapide lecture BDD + mémoire à matrice).

---

## 4. API d’estimation (Next.js Route Handler `/api/estimate`)

### 4.1 Flux fonctionnel

1. **Entrée** : corps JSON `{ brand, model, category, condition }` (validation stricte des énumérations `category` et `condition`).
2. **Matching** : retrouver **au plus une** ligne pertinente dans `catalog_prices` pour la catégorie donnée, à partir des chaînes `brand` et `model` saisies (bruitées).
3. **Lecture du prix neuf** : `retail_price` de la ligne retenue (ou logique de désambiguïsation si plusieurs candidats).
4. **Application de la matrice** : `α_cat` et `α_etat` selon les tables de référence (versionnées idéalement).
5. **Sortie** : JSON `{ netSellerPrice, retailPriceMatched, matchedBrand?, matchedModel?, ... }` — le détail exact des champs exposés au front est à trancher (transparence vs concis).

### 4.2 Gestion des échecs de matching

- Aucune ligne ou score trop faible : **404** ou **422** avec message métier du type « Référence non trouvée en catalogue » — distinct d’une erreur serveur 500.
- Plusieurs candidats équivalents : politique de **tri** (similarité décroissante, puis `updated_at` le plus récent) et éventuellement **liste courte** pour une future étape « choix utilisateur » (hors périmètre MVP possible).

### 4.3 Stratégie de correspondance (fuzzy matching)

**Objectif :** rapprocher « shark d skwal3 », « Shark D-SKWAL 3 », « shark d skwal iii » d’une entrée canonique `Shark` / `D-Skwal 3`.

**Piste A — Côté SQL (PostgreSQL / Supabase)**

- **Normalisation** systématique en amont : minuscules, suppression accents, suppression ponctuation superflue, espaces compactés (`normalize("NFD")` côté app ou en RPC).
- **`ILIKE` + trigrammes** : extension `pg_trgm` avec opérateur `%` ou `similarity()` ; requête du type « meilleur score parmi les lignes de la même `category` ».
- **Avantage :** performant sur volume catalogue modéré, index GIN, une seule requête.
- **Inconvénient :** réglage des seuils (`similarity` minimum) à calibrer.

**Piste B — Côté application (Levenshtein / distance normalisée)**

- Calcul sur un **sous-ensemble** déjà filtré (même `category` + pré-filtre `brand ILIKE 'Sha%'`) pour limiter le coût.
- **Avantage :** contrôle fin, tests unitaires simples sur paires chaîne → score.
- **Inconvénient :** plus de logique applicative ; risque de N×M si mal filtré.

**Recommandation pour le plan définitif :**

1. Stocker ou calculer **`normalized_brand`** et **`normalized_model`** (colonnes matérialisées ou générées) pour indexer et comparer proprement.  
2. **Étape 1** : tenter une **égalité stricte** sur champs normalisés + `category`.  
3. **Étape 2** : si échec, **requête trigram** (`pg_trgm`) avec seuil minimal et limite `LIMIT 5`, prendre le meilleur score.  
4. **Étape 3** (optionnelle) : si ambiguïté (écart de score faible entre 2 lignes), refuser le match automatique et retourner une erreur « ambigu » ou un besoin de désambiguïsation.

**Levenshtein seul** n’est pas obligatoire si `pg_trgm` est disponible sur Supabase ; en revanche, une **distance normalisée** peut servir de **second critère** de tie-break en TypeScript sur les 5 meilleurs candidats SQL.

### 4.4 Sécurité et performance

- Requêtes Supabase via **clé service** côté serveur uniquement (Route Handler), jamais la clé anon exposée avec RLS contournée pour cette lecture sensible si besoin — ou RLS policies lecture `catalog_prices` pour `authenticated service`.
- **Cache** optionnel en mémoire (catalogue peu volatile) avec TTL pour réduire la charge ; invalidation lors des imports.

---

## 5. Synthèse des décisions à valider avant implémentation

| Sujet | Décision attendue |
|--------|-------------------|
| Valeurs numériques `α_cat` | Validation finance / produit |
| Unicité métier en base | `UNIQUE` sur triplet normalisé + catégorie ? |
| Comportement si Net ≤ 0 | Plancher 0 vs refus d’offre |
| Champs de réponse API | Transparence (`retailPriceMatched`, scores de match) |
| Pipeline d’import | Worker autonome vs Vercel Cron partiel |
| Seuil `similarity` / `%` trigram | Mesure empirique sur échantillon de saisies réelles |

---

*Document rédigé pour validation architecture — aucune implémentation fonctionnelle livrée avec ce plan.*
