/**
 * Data models for the Nanopublication Test Suite Connector.
 */

import * as fs from 'node:fs';

export enum TestSuiteSubfolder {
  PLAIN = 'plain',
  SIGNED = 'signed',
  TRUSTY = 'trusty',
}

/** A single nanopublication test file in the test suite. */
export class TestSuiteEntry {
  constructor(
    /** Filename (e.g. `nanopub1.trig`). */
    readonly name: string,
    /** Absolute path to the extracted file. */
    readonly path: string,
    /** Which category this entry belongs to. */
    readonly subfolder: TestSuiteSubfolder,
    /** `true` if this entry lives under `valid/`, `false` if under `invalid/`. */
    readonly valid: boolean,
  ) {}

  /** Return the full content of the test file as a string. */
  readText(encoding: BufferEncoding = 'utf8'): string {
    return fs.readFileSync(this.path, encoding);
  }

  /** Return the raw bytes of the test file. */
  readBytes(): Buffer {
    return fs.readFileSync(this.path);
  }
}

/** Paths to a private/public RSA key pair used in transform test cases. */
export class SigningKeyPair {
  constructor(
    /** Key name (e.g. `rsa-key1`). */
    readonly name: string,
    /** Absolute path to the private key PEM file. */
    readonly privateKey: string,
    /** Absolute path to the public key PEM file. */
    readonly publicKey: string,
  ) {}
}

/** Pairs a plain nanopub with its expected signed/trusty output. */
export class TransformTestCase {
  constructor(
    /** Signing key used for this transform (e.g. `rsa-key1`). */
    readonly keyName: string,
    /** The input `TestSuiteEntry` (from `transform/plain`). */
    readonly plain: TestSuiteEntry,
    /** The expected signed `TestSuiteEntry` (from `transform/signed/<keyName>`). */
    readonly signed: TestSuiteEntry,
    /** Expected artifact code read from the `*.out.code` file, or `undefined` if absent. */
    readonly outCode: string | undefined,
  ) {}
}
