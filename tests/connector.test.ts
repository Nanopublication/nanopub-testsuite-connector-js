/**
 * Tests for the NanopubTestSuite connector.
 *
 * Network-dependent tests (getLatest, getAtCommit) are marked with the
 * "integration" tag and skipped by default. Run them with:
 *   vitest run --reporter=verbose tests/connector.test.ts --include-tags integration
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  NanopubTestSuite,
  TestSuiteEntry,
  TestSuiteSubfolder,
  TransformTestCase,
  SigningKeyPair,
} from '../src/index.js';

// ------------------------------------------------------------------ //
// Helpers: build a minimal fake test suite on disk                   //
// ------------------------------------------------------------------ //

const SAMPLE_PLAIN_TRIG = `@prefix this: <http://purl.org/nanopub/temp/np/> .
@prefix np: <http://www.nanopub.org/nschema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
this: {
  this: np:hasAssertion this:assertion ;
        np:hasProvenance this:provenance ;
        np:hasPublicationInfo this:pubinfo .
}
this:assertion { <https://example.org/s> <https://example.org/p> <https://example.org/o> . }
this:provenance { this:assertion <http://www.w3.org/ns/prov#wasAttributedTo> <https://orcid.org/0000-0000-0000-0000> . }
this:pubinfo { this: <http://purl.org/dc/terms/created> "2024-01-01T00:00:00Z"^^xsd:dateTime . }
`;

const SAMPLE_TRUSTY_TRIG = `@prefix this: <https://w3id.org/np/RAexampleArtifactCode1234567890abcdefghijklmn/> .
@prefix np: <http://www.nanopub.org/nschema#> .
this: {
  this: np:hasAssertion this:assertion ;
        np:hasProvenance this:provenance ;
        np:hasPublicationInfo this:pubinfo .
}
this:assertion { <https://example.org/s> <https://example.org/p> <https://example.org/o> . }
this:provenance { this:assertion <http://www.w3.org/ns/prov#wasAttributedTo> <https://orcid.org/0000-0000-0000-0000> . }
this:pubinfo { this: <http://purl.org/dc/terms/created> "2024-01-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> . }
`;

const SAMPLE_INVALID_TRIG = `@prefix this: <http://purl.org/nanopub/temp/np/> .
this: { }
`;

const SAMPLE_PRIVATE_KEY =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtEsHAGFMIUdnZBWqiGPEHXJF\n-----END RSA PRIVATE KEY-----\n';
const SAMPLE_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xHn/ygWe\n-----END PUBLIC KEY-----\n';

/** Build a fake test suite directory tree and return its root path. */
function buildFakeTestSuite(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-testsuite-'));

  // valid/plain
  const validPlain = path.join(root, 'valid', 'plain');
  fs.mkdirSync(validPlain, { recursive: true });
  fs.writeFileSync(path.join(validPlain, 'simple1.trig'), SAMPLE_PLAIN_TRIG);
  fs.writeFileSync(path.join(validPlain, 'simple2.trig'), SAMPLE_PLAIN_TRIG);

  // valid/trusty
  const validTrusty = path.join(root, 'valid', 'trusty');
  fs.mkdirSync(validTrusty, { recursive: true });
  fs.writeFileSync(
    path.join(validTrusty, 'RAexampleArtifactCode1234567890abcdefghijklmn.trig'),
    SAMPLE_TRUSTY_TRIG,
  );

  // invalid/plain
  const invalidPlain = path.join(root, 'invalid', 'plain');
  fs.mkdirSync(invalidPlain, { recursive: true });
  fs.writeFileSync(path.join(invalidPlain, 'empty.trig'), SAMPLE_INVALID_TRIG);

  // transform/plain
  const transformPlain = path.join(root, 'transform', 'plain');
  fs.mkdirSync(transformPlain, { recursive: true });
  fs.writeFileSync(path.join(transformPlain, 'simple1.trig'), SAMPLE_PLAIN_TRIG);

  // transform/signed/rsa-key1
  const keyDir = path.join(root, 'transform', 'signed', 'rsa-key1');
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(path.join(keyDir, 'private_key.pem'), SAMPLE_PRIVATE_KEY);
  fs.writeFileSync(path.join(keyDir, 'public_key.pem'), SAMPLE_PUBLIC_KEY);
  fs.writeFileSync(path.join(keyDir, 'simple1.trig'), SAMPLE_TRUSTY_TRIG);
  fs.writeFileSync(
    path.join(keyDir, 'simple1.out.code'),
    'RAexampleArtifactCode1234567890abcdefghijklmn\n',
  );

  return root;
}

/** Build a fake suite instance without network access. */
function buildFakeSuite(root: string): NanopubTestSuite {
  // Use the public constructor with hand-rolled entries
  const validPlainEntry = new TestSuiteEntry(
    'simple1.trig',
    path.join(root, 'valid', 'plain', 'simple1.trig'),
    TestSuiteSubfolder.PLAIN,
    true,
  );
  const validPlainEntry2 = new TestSuiteEntry(
    'simple2.trig',
    path.join(root, 'valid', 'plain', 'simple2.trig'),
    TestSuiteSubfolder.PLAIN,
    true,
  );
  const validTrustyEntry = new TestSuiteEntry(
    'RAexampleArtifactCode1234567890abcdefghijklmn.trig',
    path.join(root, 'valid', 'trusty', 'RAexampleArtifactCode1234567890abcdefghijklmn.trig'),
    TestSuiteSubfolder.TRUSTY,
    true,
  );
  const invalidEntry = new TestSuiteEntry(
    'empty.trig',
    path.join(root, 'invalid', 'plain', 'empty.trig'),
    TestSuiteSubfolder.PLAIN,
    false,
  );
  const plainTransformEntry = new TestSuiteEntry(
    'simple1.trig',
    path.join(root, 'transform', 'plain', 'simple1.trig'),
    TestSuiteSubfolder.PLAIN,
    true,
  );
  const signedTransformEntry = new TestSuiteEntry(
    'simple1.trig',
    path.join(root, 'transform', 'signed', 'rsa-key1', 'simple1.trig'),
    TestSuiteSubfolder.SIGNED,
    true,
  );
  const keyPair = new SigningKeyPair(
    'rsa-key1',
    path.join(root, 'transform', 'signed', 'rsa-key1', 'private_key.pem'),
    path.join(root, 'transform', 'signed', 'rsa-key1', 'public_key.pem'),
  );
  const transformCase = new TransformTestCase(
    'rsa-key1',
    plainTransformEntry,
    signedTransformEntry,
    'RAexampleArtifactCode1234567890abcdefghijklmn',
  );

  return new NanopubTestSuite(
    root,
    'test-ref',
    [validPlainEntry, validPlainEntry2, validTrustyEntry],
    [invalidEntry],
    [transformCase],
    new Map([['rsa-key1', keyPair]]),
  );
}

// ------------------------------------------------------------------ //
// Tests                                                               //
// ------------------------------------------------------------------ //

let fakeRoot: string;
let suite: NanopubTestSuite;

beforeAll(() => {
  fakeRoot = buildFakeTestSuite();
  suite = buildFakeSuite(fakeRoot);
});

afterAll(() => {
  fs.rmSync(fakeRoot, { recursive: true, force: true });
});

describe('NanopubTestSuite - construction', () => {
  it('reports correct version', () => {
    expect(suite.version).toBe('test-ref');
  });

  it('exposes root path', () => {
    expect(suite.root).toBe(fakeRoot);
  });

  it('toString includes counts', () => {
    const s = suite.toString();
    expect(s).toContain('valid=3');
    expect(s).toContain('invalid=1');
    expect(s).toContain('transforms=1');
  });
});

describe('NanopubTestSuite - getValid / getInvalid', () => {
  it('returns all valid entries', () => {
    expect(suite.getValid()).toHaveLength(3);
  });

  it('filters valid entries by PLAIN', () => {
    const plain = suite.getValid(TestSuiteSubfolder.PLAIN);
    expect(plain).toHaveLength(2);
    expect(plain.every((e) => e.subfolder === TestSuiteSubfolder.PLAIN)).toBe(true);
  });

  it('filters valid entries by TRUSTY', () => {
    const trusty = suite.getValid(TestSuiteSubfolder.TRUSTY);
    expect(trusty).toHaveLength(1);
    expect(trusty[0].subfolder).toBe(TestSuiteSubfolder.TRUSTY);
  });

  it('filters valid entries by SIGNED (empty)', () => {
    expect(suite.getValid(TestSuiteSubfolder.SIGNED)).toHaveLength(0);
  });

  it('returns all invalid entries', () => {
    expect(suite.getInvalid()).toHaveLength(1);
    expect(suite.getInvalid()[0].valid).toBe(false);
  });

  it('getValid returns copies (mutation-safe)', () => {
    const a = suite.getValid();
    const b = suite.getValid();
    expect(a).not.toBe(b);
  });
});

describe('NanopubTestSuite - TestSuiteEntry', () => {
  it('entry has correct name, path, subfolder and valid flag', () => {
    const entry = suite.getValid(TestSuiteSubfolder.PLAIN)[0];
    expect(entry.name).toBe('simple1.trig');
    expect(entry.subfolder).toBe(TestSuiteSubfolder.PLAIN);
    expect(entry.valid).toBe(true);
    expect(entry.path).toContain('simple1.trig');
  });

  it('readText returns file content', () => {
    const entry = suite.getValid(TestSuiteSubfolder.PLAIN)[0];
    const text = entry.readText();
    expect(text).toContain('np:hasAssertion');
  });

  it('readBytes returns a Buffer', () => {
    const entry = suite.getValid(TestSuiteSubfolder.PLAIN)[0];
    expect(entry.readBytes()).toBeInstanceOf(Buffer);
  });
});

describe('NanopubTestSuite - getByArtifactCode', () => {
  it('finds a trusty entry by its artifact code', () => {
    const entry = suite.getByArtifactCode('RAexampleArtifactCode1234567890abcdefghijklmn');
    expect(entry.subfolder).toBe(TestSuiteSubfolder.TRUSTY);
    expect(entry.valid).toBe(true);
  });

  it('throws for unknown artifact code', () => {
    expect(() => suite.getByArtifactCode('RAxxxxxxxxxUnknownxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toThrow();
  });
});

describe('NanopubTestSuite - getByNanopubUri', () => {
  it('finds a trusty entry by its nanopub URI', () => {
    const entry = suite.getByNanopubUri(
      'https://w3id.org/np/RAexampleArtifactCode1234567890abcdefghijklmn',
    );
    expect(entry.subfolder).toBe(TestSuiteSubfolder.TRUSTY);
  });

  it('throws for unknown URI', () => {
    expect(() => suite.getByNanopubUri('https://example.org/np/RAxxx')).toThrow();
  });
});

describe('NanopubTestSuite - transform cases', () => {
  it('returns all transform cases', () => {
    const cases = suite.getTransformCases();
    expect(cases).toHaveLength(1);
  });

  it('filters by key name', () => {
    expect(suite.getTransformCases('rsa-key1')).toHaveLength(1);
    expect(suite.getTransformCases('rsa-key99')).toHaveLength(0);
  });

  it('transform case has correct fields', () => {
    const tc = suite.getTransformCases('rsa-key1')[0];
    expect(tc.keyName).toBe('rsa-key1');
    expect(tc.plain.subfolder).toBe(TestSuiteSubfolder.PLAIN);
    expect(tc.signed.subfolder).toBe(TestSuiteSubfolder.SIGNED);
    expect(tc.outCode).toBe('RAexampleArtifactCode1234567890abcdefghijklmn');
  });

  it('transform plain entry is readable', () => {
    const tc = suite.getTransformCases('rsa-key1')[0];
    expect(tc.plain.readText()).toContain('np:hasAssertion');
  });
});

describe('NanopubTestSuite - signing keys', () => {
  it('returns the signing key pair', () => {
    const key = suite.getSigningKey('rsa-key1');
    expect(key.name).toBe('rsa-key1');
    expect(key.privateKey).toContain('private_key.pem');
    expect(key.publicKey).toContain('public_key.pem');
    expect(fs.existsSync(key.privateKey)).toBe(true);
    expect(fs.existsSync(key.publicKey)).toBe(true);
  });

  it('throws for unknown key name', () => {
    expect(() => suite.getSigningKey('unknown-key')).toThrow(/not found/);
  });

  it('error message lists available keys', () => {
    expect(() => suite.getSigningKey('unknown-key')).toThrow(/rsa-key1/);
  });
});

describe('NanopubTestSuite - iteration', () => {
  it('iterates over all entries (valid + invalid)', () => {
    const all = [...suite];
    expect(all).toHaveLength(4); // 3 valid + 1 invalid
  });
});

// ------------------------------------------------------------------ //
// Integration tests (require network access)                          //
// ------------------------------------------------------------------ //

describe.skip('NanopubTestSuite - integration (requires network)', () => {
  let liveSuite: NanopubTestSuite;

  beforeAll(async () => {
    liveSuite = await NanopubTestSuite.getLatest();
  }, 60_000);

  it('getLatest returns a suite with valid entries', () => {
    expect(liveSuite.getValid().length).toBeGreaterThan(0);
  });

  it('has valid PLAIN entries', () => {
    expect(liveSuite.getValid(TestSuiteSubfolder.PLAIN).length).toBeGreaterThan(0);
  });

  it('has valid TRUSTY entries', () => {
    expect(liveSuite.getValid(TestSuiteSubfolder.TRUSTY).length).toBeGreaterThan(0);
  });

  it('has invalid entries', () => {
    expect(liveSuite.getInvalid().length).toBeGreaterThan(0);
  });

  it('has transform cases for rsa-key1', () => {
    expect(liveSuite.getTransformCases('rsa-key1').length).toBeGreaterThan(0);
  });

  it('signing key files exist on disk', () => {
    const key = liveSuite.getSigningKey('rsa-key1');
    expect(fs.existsSync(key.privateKey)).toBe(true);
    expect(fs.existsSync(key.publicKey)).toBe(true);
  });

  it('can look up trusty entry by artifact code', () => {
    const trusty = liveSuite.getValid(TestSuiteSubfolder.TRUSTY);
    if (trusty.length === 0) return;
    const code = /RA[A-Za-z0-9_-]{40,}/.exec(trusty[0].name)?.[0];
    if (!code) return;
    const found = liveSuite.getByArtifactCode(code);
    expect(found.name).toBe(trusty[0].name);
  });

  it('version is set', () => {
    expect(liveSuite.version).toBe('main');
  });
});
