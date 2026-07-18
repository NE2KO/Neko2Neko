import { join } from 'node:path';
import db, { stmts } from '../db.js';
import { resolveFullPath } from './fileScanner.js';

function getFileById(fileId) {
  return stmts.getFileWithPath.get(fileId);
}

function resolveFullPathFromDB(fileId) {
  const file = stmts.getFileWithPath.get(fileId);
  if (!file) return null;
  const relPath = file.dir_path ? join(file.dir_path, file.name) : file.name;
  return resolveFullPath(relPath);
}

function getFileWithRelPath(fileId) {
  const file = stmts.getFileWithPath.get(fileId);
  if (!file) return null;
  const relPath = file.dir_path ? join(file.dir_path, file.name) : file.name;
  const realPath = resolveFullPath(relPath);
  return { ...file, relPath, fullPath: realPath };
}

export { getFileById, resolveFullPathFromDB, getFileWithRelPath };
