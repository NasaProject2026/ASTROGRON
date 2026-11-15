export function validateManifestRelativePath(rawPath: string): {
  valid: boolean;
  reason?: string;
  posixPath?: string;
};

export function verifyManifestDirectory(
  rootDir: string,
  manifestRelativePath?: string
): {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  errors: string[];
};
