import * as fs from 'node:fs';
import * as https from 'node:https';
import * as http from 'node:http';
import * as path from 'node:path';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { IncomingMessage } from 'node:http';

import {
  SigningKeyPair,
  TestSuiteEntry,
  TestSuiteSubfolder,
  TransformTestCase,
} from './models.js';

const GITHUB_ARCHIVE_URL =
  'https://github.com/Nanopublication/nanopub-testsuite/archive/{ref}.tar.gz';

const SUBFOLDER_MAP: Record<string, TestSuiteSubfolder> = {
  plain: TestSuiteSubfolder.PLAIN,
  signed: TestSuiteSubfolder.SIGNED,
  trusty: TestSuiteSubfolder.TRUSTY,
};

const TRUSTY_CODE_RE = /RA[A-Za-z0-9_-]{40,}/;
const PREFIX_THIS_RE = /^@prefix\s+this:\s*<([^>]+)>/m;

/**
 * Programmatic accessor for the Nanopublication Test Suite.
 *
 * @example
 * ```ts
 * const suite = await NanopubTestSuite.getLatest();
 * for (const entry of suite.getValid(TestSuiteSubfolder.PLAIN)) {
 *   console.log(entry.name, entry.path);
 * }
 * ```
 *
 * The constructor is not meant to be called directly — use the factory
 * methods {@link getLatest} or {@link getAtCommit}.
 */
export class NanopubTestSuite {
  private readonly _root: string;
  private readonly _version: string;
  private readonly _valid: TestSuiteEntry[];
  private readonly _invalid: TestSuiteEntry[];
  private readonly _transformCases: TransformTestCase[];
  private readonly _signingKeys: Map<string, SigningKeyPair>;
  private readonly _byArtifactCode: Map<string, TestSuiteEntry>;
  private readonly _byNanopubUri: Map<string, TestSuiteEntry>;

  // ------------------------------------------------------------------ //
  // Factories                                                            //
  // ------------------------------------------------------------------ //

  /** Download and load the *latest* test suite (`main` branch). */
  static async getLatest(): Promise<NanopubTestSuite> {
    return NanopubTestSuite._load('main');
  }

  /**
   * Download and load the test suite at a specific commit SHA.
   *
   * @param commitSha - Full or abbreviated commit SHA on the `main` branch.
   */
  static async getAtCommit(commitSha: string): Promise<NanopubTestSuite> {
    return NanopubTestSuite._load(commitSha);
  }

  // ------------------------------------------------------------------ //
  // Internal init                                                        //
  // ------------------------------------------------------------------ //

  constructor(
    root: string,
    version: string,
    validEntries: TestSuiteEntry[],
    invalidEntries: TestSuiteEntry[],
    transformCases: TransformTestCase[],
    signingKeys: Map<string, SigningKeyPair>,
  ) {
    this._root = root;
    this._version = version;
    this._valid = validEntries;
    this._invalid = invalidEntries;
    this._transformCases = transformCases;
    this._signingKeys = signingKeys;

    // Build lookup indices
    this._byArtifactCode = new Map();
    this._byNanopubUri = new Map();
    for (const entry of [...validEntries, ...invalidEntries]) {
      const code = artifactCodeFromFile(entry.path);
      if (code) this._byArtifactCode.set(code, entry);
      const uri = nanopubUriFromFile(entry.path);
      if (uri) this._byNanopubUri.set(uri, entry);
    }
  }

  // ------------------------------------------------------------------ //
  // Public API                                                           //
  // ------------------------------------------------------------------ //

  /** Git ref (branch name or commit SHA) used to fetch this suite. */
  get version(): string {
    return this._version;
  }

  /** Temporary directory that holds the extracted archive. */
  get root(): string {
    return this._root;
  }

  /**
   * Return all *valid* test entries, optionally filtered by subfolder.
   *
   * @param subfolder - When given, only entries from that subfolder are returned.
   */
  getValid(subfolder?: TestSuiteSubfolder): TestSuiteEntry[] {
    return filter(this._valid, subfolder);
  }

  /**
   * Return all *invalid* test entries, optionally filtered by subfolder.
   *
   * @param subfolder - When given, only entries from that subfolder are returned.
   */
  getInvalid(subfolder?: TestSuiteSubfolder): TestSuiteEntry[] {
    return filter(this._invalid, subfolder);
  }

  /**
   * Return transform test cases, optionally filtered by signing key name.
   *
   * @param keyName - When given (e.g. `"rsa-key1"`), only cases using that key are returned.
   */
  getTransformCases(keyName?: string): TransformTestCase[] {
    if (!keyName) return [...this._transformCases];
    return this._transformCases.filter((tc) => tc.keyName === keyName);
  }

  /**
   * Return the signing key pair for the given key name.
   *
   * @param keyName - Key directory name (e.g. `"rsa-key1"`).
   * @throws If `keyName` is not found in the suite.
   */
  getSigningKey(keyName: string): SigningKeyPair {
    const key = this._signingKeys.get(keyName);
    if (!key) {
      const available = [...this._signingKeys.keys()].sort().join(', ');
      throw new Error(`Signing key '${keyName}' not found. Available: ${available}`);
    }
    return key;
  }

  /**
   * Look up an entry by its Trusty URI artifact code.
   *
   * @param code - The artifact code portion of the Trusty URI
   *               (e.g. `"RA1sViVmXf-W2aZW4Qk74KTaiD9gpLBPe2LhMsinHKKz8"`).
   * @throws If no entry matches `code`.
   */
  getByArtifactCode(code: string): TestSuiteEntry {
    const entry = this._byArtifactCode.get(code);
    if (!entry) throw new Error(`No entry found for artifact code '${code}'`);
    return entry;
  }

  /**
   * Look up an entry by its full nanopublication URI.
   *
   * @param uri - Full nanopub URI (e.g. `"https://w3id.org/np/RA..."`).
   * @throws If no entry matches `uri`.
   */
  getByNanopubUri(uri: string): TestSuiteEntry {
    const entry = this._byNanopubUri.get(uri);
    if (!entry) throw new Error(`No entry found for nanopub URI '${uri}'`);
    return entry;
  }

  /** Iterate over *all* entries (valid + invalid). */
  [Symbol.iterator](): Iterator<TestSuiteEntry> {
    return [...this._valid, ...this._invalid][Symbol.iterator]();
  }

  toString(): string {
    return (
      `NanopubTestSuite(version=${this._version}, ` +
      `valid=${this._valid.length}, invalid=${this._invalid.length}, ` +
      `transforms=${this._transformCases.length})`
    );
  }

  // ------------------------------------------------------------------ //
  // Private helpers                                                      //
  // ------------------------------------------------------------------ //

  private static async _load(ref: string): Promise<NanopubTestSuite> {
    const url = GITHUB_ARCHIVE_URL.replace('{ref}', ref);
    const data = await download(url);
    const decompressed = zlib.gunzipSync(data);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopub-testsuite-'));
    extractTar(decompressed, tmpDir);

    // GitHub wraps archive contents in a top-level directory like
    // `nanopub-testsuite-<sha>/`. Find it.
    let root = tmpDir;
    const subdirs = fs
      .readdirSync(tmpDir)
      .filter((f) => fs.statSync(path.join(tmpDir, f)).isDirectory());
    if (subdirs.length === 1) root = path.join(tmpDir, subdirs[0]);

    const validEntries = indexEntries(path.join(root, 'valid'), true);
    const invalidEntries = indexEntries(path.join(root, 'invalid'), false);
    const { transformCases, signingKeys } = indexTransforms(path.join(root, 'transform'));

    return new NanopubTestSuite(root, ref, validEntries, invalidEntries, transformCases, signingKeys);
  }
}

// ------------------------------------------------------------------ //
// Internal helpers                                                    //
// ------------------------------------------------------------------ //

function filter(entries: TestSuiteEntry[], subfolder?: TestSuiteSubfolder): TestSuiteEntry[] {
  if (!subfolder) return [...entries];
  return entries.filter((e) => e.subfolder === subfolder);
}

/** Download a URL, following redirects. Returns raw bytes. */
function download(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, (res: IncomingMessage) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          const location = res.headers.location;
          if (!location) return reject(new Error('Redirect with no Location header'));
          res.resume();
          resolve(download(location));
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Parse a tar buffer and extract files into `destDir`. */
function extractTar(buffer: Buffer, destDir: string): void {
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);

    // End-of-archive: two consecutive zero blocks
    if (isZeroBlock(header)) break;

    // Filename: bytes 0–99, with optional prefix at bytes 345–499
    const rawName = readString(header, 0, 100);
    const rawPrefix = readString(header, 345, 155);
    const fullName = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;

    // File size: octal string at bytes 124–135
    const sizeStr = readString(header, 124, 12).trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;

    // Type flag: byte 156
    // '0' or '\0' = regular file, '5' = directory
    const typeFlag = header[156];

    offset += 512;

    if (typeFlag === 0x35 /* '5' */) {
      // Directory
      if (fullName) fs.mkdirSync(path.join(destDir, fullName), { recursive: true });
    } else if (typeFlag === 0x30 /* '0' */ || typeFlag === 0 /* '\0' */) {
      // Regular file
      const destPath = path.join(destDir, fullName);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buffer.subarray(offset, offset + size));
    }

    // Advance past data blocks (size rounded up to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }
}

function isZeroBlock(buf: Buffer): boolean {
  for (let i = 0; i < 512; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function readString(buf: Buffer, start: number, length: number): string {
  return buf.subarray(start, start + length).toString('utf8').replace(/\0+$/, '');
}

/** Walk `base` (`valid/` or `invalid/`) and build an entry list. */
function indexEntries(base: string, valid: boolean): TestSuiteEntry[] {
  if (!fs.existsSync(base)) return [];

  const entries: TestSuiteEntry[] = [];
  const subDirs = fs.readdirSync(base).sort();

  for (const subName of subDirs) {
    const subPath = path.join(base, subName);
    if (!fs.statSync(subPath).isDirectory()) continue;
    const sf = SUBFOLDER_MAP[subName];
    if (!sf) continue;

    const files = fs.readdirSync(subPath).sort();
    for (const fileName of files) {
      if (!fileName.endsWith('.trig')) continue;
      entries.push(
        new TestSuiteEntry(fileName, path.join(subPath, fileName), sf, valid),
      );
    }
  }

  return entries;
}

/** Parse the `transform/` directory into cases and key pairs. */
function indexTransforms(transformDir: string): {
  transformCases: TransformTestCase[];
  signingKeys: Map<string, SigningKeyPair>;
} {
  const transformCases: TransformTestCase[] = [];
  const signingKeys = new Map<string, SigningKeyPair>();

  if (!fs.existsSync(transformDir)) return { transformCases, signingKeys };

  // Index plain input files.
  // Files are named either `simple1.trig` or `simple1.in.trig`; in both cases
  // we key by the base name without the optional `.in` suffix.
  const plainDir = path.join(transformDir, 'plain');
  const plainEntries = new Map<string, TestSuiteEntry>();
  if (fs.existsSync(plainDir)) {
    for (const fileName of fs.readdirSync(plainDir).sort()) {
      if (!fileName.endsWith('.trig')) continue;
      // Strip optional `.in` before `.trig`: "simple1.in.trig" → "simple1"
      const baseName = fileName.replace(/(?:\.in)?\.trig$/, '');
      plainEntries.set(
        baseName,
        new TestSuiteEntry(fileName, path.join(plainDir, fileName), TestSuiteSubfolder.PLAIN, true),
      );
    }
  }

  const signedDir = path.join(transformDir, 'signed');
  if (!fs.existsSync(signedDir)) return { transformCases, signingKeys };

  for (const keyName of fs.readdirSync(signedDir).sort()) {
    const keyDir = path.join(signedDir, keyName);
    if (!fs.statSync(keyDir).isDirectory()) continue;

    // Collect signing key pair.
    // Keys may live directly in keyDir or inside a `key/` subdirectory.
    let privateKeyPath = path.join(keyDir, 'private_key.pem');
    let publicKeyPath = path.join(keyDir, 'public_key.pem');

    // Search keyDir and its immediate subdirectories for key files.
    const keySearchDirs = [keyDir];
    for (const entry of fs.readdirSync(keyDir)) {
      const p = path.join(keyDir, entry);
      if (fs.statSync(p).isDirectory()) keySearchDirs.push(p);
    }

    for (const dir of keySearchDirs) {
      if (!fs.existsSync(privateKeyPath)) {
        const candidates = fs
          .readdirSync(dir)
          .filter((f) => f === 'private_key.pem' || f === 'id_rsa' || f.includes('private'));
        if (candidates.length) privateKeyPath = path.join(dir, candidates[0]);
      }
      if (!fs.existsSync(publicKeyPath)) {
        const candidates = fs
          .readdirSync(dir)
          .filter((f) => f === 'public_key.pem' || f.endsWith('.pub') || f.includes('public'));
        if (candidates.length) publicKeyPath = path.join(dir, candidates[0]);
      }
    }

    if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
      signingKeys.set(keyName, new SigningKeyPair(keyName, privateKeyPath, publicKeyPath));
    }

    // Pair each signed nanopub with its plain counterpart.
    // Files are named either `simple1.trig` or `simple1.out.trig`; in both
    // cases we strip the optional `.out` to get the shared base name.
    for (const fileName of fs.readdirSync(keyDir).sort()) {
      if (!fileName.endsWith('.trig')) continue;
      // Strip optional `.out` before `.trig`: "simple1.out.trig" → "simple1"
      const baseName = fileName.replace(/(?:\.out)?\.trig$/, '');
      const plainEntry = plainEntries.get(baseName);
      if (!plainEntry) continue;

      const signedEntry = new TestSuiteEntry(
        fileName,
        path.join(keyDir, fileName),
        TestSuiteSubfolder.SIGNED,
        true,
      );

      // Derive the .out.code filename:
      //   "simple1.out.trig" → "simple1.out.code"
      //   "simple1.trig"     → "simple1.out.code"
      const outCodeName = fileName.endsWith('.out.trig')
        ? fileName.replace(/\.out\.trig$/, '.out.code')
        : fileName.replace(/\.trig$/, '.out.code');
      const outCodeFile = path.join(keyDir, outCodeName);
      const outCode = fs.existsSync(outCodeFile)
        ? fs.readFileSync(outCodeFile, 'utf8').trim()
        : undefined;

      transformCases.push(new TransformTestCase(keyName, plainEntry, signedEntry, outCode));
    }
  }

  return { transformCases, signingKeys };
}

// ------------------------------------------------------------------ //
// Nanopub URI / artifact code extraction                              //
// ------------------------------------------------------------------ //

/** Read a .trig file and extract the artifact code from the `@prefix this:` URI. */
function artifactCodeFromFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const m = PREFIX_THIS_RE.exec(content);
    if (!m) return undefined;
    const code = TRUSTY_CODE_RE.exec(m[1]);
    return code ? code[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Read a .trig file and extract the nanopub URI from the `@prefix this:` declaration. */
function nanopubUriFromFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const m = PREFIX_THIS_RE.exec(content);
    if (!m) return undefined;
    return m[1].replace(/[/#]$/, '');
  } catch {
    return undefined;
  }
}
