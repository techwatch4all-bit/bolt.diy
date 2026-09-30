import ElectronStore from 'electron-store';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

let key = '';
let keyPath = '';
try {
  // First try: Electron userData directory
  const electron = require('electron');
  const userData = electron.app?.getPath('userData') || tmpdir();
  keyPath = join(userData, 'encryption.key');
  if (existsSync(keyPath)) {
    key = readFileSync(keyPath, 'utf8').toString().trim();
  } else {
    key = randomBytes(32).toString('hex');
    writeFileSync(keyPath, key, { mode: 0o600 });
  }
} catch {
  try {
    // Second try: home directory
    keyPath = join(homedir(), '.bolt-diy');
    if (existsSync(keyPath)) {
      key = readFileSync(keyPath, 'utf8').toString().trim();
    } else {
      key = randomBytes(32).toString('hex');
      writeFileSync(keyPath, key, { mode: 0o600 });
    }
  } catch {
    // Final fallback: temp directory
    keyPath = join(tmpdir(), 'bolt-diy-encryption.key');
    if (existsSync(keyPath)) {
      key = readFileSync(keyPath, 'utf8').toString().trim();
    } else {
      key = randomBytes(32).toString('hex');
      writeFileSync(keyPath, key, { mode: 0o600 });
    }
  }
}

export const store = new ElectronStore<any>({ encryptionKey: key });
