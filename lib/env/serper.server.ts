function trimEnvValue(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

export function getSerperServerConfig(): {
  apiKey: string | undefined;
} {
  return {
    apiKey: trimEnvValue(process.env.SERPER_API_KEY),
  };
}
