# nanopub-testsuite-connector

Programmatic access to the [Nanopublication Test Suite](https://github.com/Nanopublication/nanopub-testsuite) for JavaScript/TypeScript.

This package downloads the official test suite from GitHub, extracts it locally, and provides a clean API for querying test cases, making it easy to validate nanopublication implementations with the canonical test data.

See also the [Java](https://github.com/Nanopublication/nanopub-testsuite-connector-java) and [Python](https://github.com/Nanopublication/nanopub-testsuite-connector-py) equivalents.

## Installation

```bash
npm install @nanopub/testsuite-connector
# or
yarn add @nanopub/testsuite-connector
```

> **Node.js ≥ 18** required. No external runtime dependencies.

## Quick start

```ts
import { NanopubTestSuite, TestSuiteSubfolder } from '@nanopub/testsuite-connector';

const suite = await NanopubTestSuite.getLatest();

// Valid plain (unsigned) nanopubs
for (const entry of suite.getValid(TestSuiteSubfolder.PLAIN)) {
  const content = entry.readText();
  console.log(entry.name, content.length);
}

// Invalid nanopubs (should be rejected)
for (const entry of suite.getInvalid()) {
  console.log(entry.name, entry.subfolder);
}
```

## API

### `NanopubTestSuite`

#### Factories

```ts
// Download the latest test suite (main branch)
const suite = await NanopubTestSuite.getLatest();

// Download the suite at a specific commit SHA
const suite = await NanopubTestSuite.getAtCommit('abc1234');
```

#### Querying entries

```ts
// All valid entries, optionally filtered by subfolder
suite.getValid()                             // all
suite.getValid(TestSuiteSubfolder.PLAIN)     // unsigned nanopubs
suite.getValid(TestSuiteSubfolder.SIGNED)    // signed nanopubs
suite.getValid(TestSuiteSubfolder.TRUSTY)    // trusty-URI nanopubs

// All invalid entries (same subfolder filter available)
suite.getInvalid()
suite.getInvalid(TestSuiteSubfolder.PLAIN)

// Iterate over all entries (valid + invalid)
for (const entry of suite) { ... }
```

#### Lookups

```ts
// By Trusty URI artifact code
const entry = suite.getByArtifactCode('RA1sViVmXf-W2aZW4Qk74KTaiD9gpLBPe2LhMsinHKKz8');

// By full nanopub URI
const entry = suite.getByNanopubUri('https://w3id.org/np/RA...');
```

#### Transform test cases

Transform cases pair a plain (unsigned) nanopub with its expected signed output and the expected artifact code. They are useful for testing signing implementations end-to-end.

```ts
// All transform cases
const cases = suite.getTransformCases();

// Filter by signing key
const cases = suite.getTransformCases('rsa-key1');

for (const tc of cases) {
  console.log(tc.keyName);           // 'rsa-key1'
  console.log(tc.plain.readText());  // input nanopub
  console.log(tc.signed.readText()); // expected signed output
  console.log(tc.outCode);           // expected artifact code (or undefined)
}
```

#### Signing keys

```ts
const key = suite.getSigningKey('rsa-key1');
console.log(key.privateKey); // absolute path to private_key.pem
console.log(key.publicKey);  // absolute path to public_key.pem
```

### `TestSuiteEntry`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Filename (e.g. `nanopub1.trig`) |
| `path` | `string` | Absolute path to the extracted file |
| `subfolder` | `TestSuiteSubfolder` | `PLAIN`, `SIGNED`, or `TRUSTY` |
| `valid` | `boolean` | `true` for valid entries, `false` for invalid |
| `readText()` | `string` | File contents as UTF-8 string |
| `readBytes()` | `Buffer` | Raw file bytes |

### `TestSuiteSubfolder`

```ts
enum TestSuiteSubfolder {
  PLAIN  = 'plain',   // unsigned nanopubs with placeholder URIs
  SIGNED = 'signed',  // cryptographically signed nanopubs
  TRUSTY = 'trusty',  // nanopubs with Trusty URIs
}
```

### `TransformTestCase`

| Property | Type | Description |
|----------|------|-------------|
| `keyName` | `string` | Signing key name (e.g. `rsa-key1`) |
| `plain` | `TestSuiteEntry` | Input (unsigned) nanopub |
| `signed` | `TestSuiteEntry` | Expected signed output nanopub |
| `outCode` | `string \| undefined` | Expected Trusty URI artifact code |

### `SigningKeyPair`

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Key name |
| `privateKey` | `string` | Absolute path to the private key PEM file |
| `publicKey` | `string` | Absolute path to the public key PEM file |

## Running the integration tests

The unit tests run offline using a fake in-memory test suite. To run the integration tests that download the real suite from GitHub:

```bash
# Edit vitest.config.ts to remove the skip, then:
yarn test
```

## License

MIT
