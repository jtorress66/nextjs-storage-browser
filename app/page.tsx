'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { withAuthenticator, Button, TextField } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

import { signOut, fetchUserAttributes } from 'aws-amplify/auth';
import { list, remove, getUrl, uploadData } from 'aws-amplify/storage';

// ✅ FIX: file is at project root, page.tsx is in /app
import config from '../amplify_outputs.json';

Amplify.configure(config);

type ListedItem = {
  path: string;
  name: string;
  isFolder: boolean;
  size?: number;
  lastModified?: Date;
};

function normalizePrefix(p: string) {
  if (!p) return '';
  return p.endsWith('/') ? p : `${p}/`;
}

function joinPrefix(base: string, child: string) {
  base = normalizePrefix(base);
  child = child.replace(/^\//, '');
  return `${base}${child}`;
}

/**
 * Build breadcrumbs from a RELATIVE prefix (no leading ROOT).
 * Example: "" -> []
 *          "UploadedProgramFiles/" -> [{label:"UploadedProgramFiles", relPrefix:"UploadedProgramFiles/"}]
 *          "a/b/" -> [{label:"a", relPrefix:"a/"}, {label:"b", relPrefix:"a/b/"}]
 */
function splitBreadcrumbRelative(relativePrefix: string) {
  const clean = relativePrefix.replace(/^\//, '').replace(/\/$/, '');
  if (!clean) return [];
  const parts = clean.split('/');
  const crumbs: { label: string; relPrefix: string }[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, relPrefix: `${acc}/` });
  }
  return crumbs;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until a file that contains the original name appears in DEST_PREFIX.
 * Assumes Lambda will rename to something like:
 *   <timestamp>_<originalName>
 * (or otherwise includes originalName somewhere in the final key).
 */
async function waitForRenamedFileInDest(destPrefix: string, originalName: string, attempts = 20, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    const resp = await list({ path: destPrefix });
    const raw = (resp as any).items ?? [];

    // Find any object whose filename includes the originalName
    const found = raw.find((obj: any) => {
      const fullPath: string = obj.path;
      if (!fullPath || fullPath.endsWith('/')) return false;
      const nameOnly = fullPath.slice(destPrefix.length);
      return nameOnly.includes(originalName);
    });

    if (found) return true;
    await sleep(delayMs);
  }
  return false;
}

function Page() {
  // Root you want to manage
  const ROOT = 'public/';

  // ✅ Lambda flow:
  // Upload here (trigger):
  const INCOMING_PREFIX = 'public/incoming/';
  // Lambda renames/moves here (what user should browse):
  const DEST_PREFIX = 'public/UploadedProgramFiles/';

  // Header UI (Matt-style)
  const APP_TITLE = "Juan's Programming Storage";

  const [userEmail, setUserEmail] = useState<string>('');

  const [currentPrefix, setCurrentPrefix] = useState<string>(ROOT);
  const [items, setItems] = useState<ListedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [newFolderName, setNewFolderName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Breadcrumbs should be built RELATIVE to ROOT (prevents public/public)
  const relativePrefix = useMemo(() => {
    if (!currentPrefix.startsWith(ROOT)) return '';
    return currentPrefix.slice(ROOT.length); // "" or "UploadedProgramFiles/"
  }, [currentPrefix]);

  const breadcrumbs = useMemo(() => splitBreadcrumbRelative(relativePrefix), [relativePrefix]);

  useEffect(() => {
    (async () => {
      try {
        const attrs = await fetchUserAttributes();
        // Common keys: email, preferred_username, etc.
        const email = (attrs as any)?.email || (attrs as any)?.preferred_username || '';
        setUserEmail(String(email || ''));
      } catch (e) {
        console.warn('fetchUserAttributes failed:', e);
        setUserEmail('');
      }
    })();
  }, []);

  async function refresh(prefixOverride?: string) {
    const path = prefixOverride ?? currentPrefix;

    setLoading(true);
    setError('');
    try {
      const resp = await list({ path });
      const raw = (resp as any).items ?? [];

      const folderSet = new Set<string>();
      const fileItems: ListedItem[] = [];

      for (const obj of raw) {
        const fullPath: string = obj.path;
        const relative = fullPath.slice(path.length);
        if (!relative) continue;

        if (relative.endsWith('/')) {
          folderSet.add(relative);
          continue;
        }

        const slashIdx = relative.indexOf('/');
        if (slashIdx >= 0) {
          const folderName = relative.slice(0, slashIdx + 1);
          folderSet.add(folderName);
        } else {
          fileItems.push({
            path: fullPath,
            name: relative,
            isFolder: false,
            size: obj.size,
            lastModified: obj.lastModified,
          });
        }
      }

      const folderItems: ListedItem[] = Array.from(folderSet)
        .map((folderRel) => ({
          path: joinPrefix(path, folderRel),
          name: folderRel,
          isFolder: true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      fileItems.sort((a, b) => a.name.localeCompare(b.name));

      setItems([...folderItems, ...fileItems]);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrefix]);

  function goUpOneLevel() {
    if (currentPrefix === ROOT) return;
    const noTrailing = currentPrefix.replace(/\/$/, '');
    const idx = noTrailing.lastIndexOf('/');
    if (idx < 0) {
      setCurrentPrefix(ROOT);
      return;
    }
    const parent = noTrailing.slice(0, idx + 1);
    setCurrentPrefix(parent || ROOT);
  }

  /**
   * ✅ Upload flow:
   * - Upload to public/incoming/<originalName>
   * - Switch view to public/UploadedProgramFiles/
   * - Poll until renamed file appears, then refresh
   */
  async function onUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setLoading(true);
    setError('');

    try {
      // 1) Upload each file to INCOMING_PREFIX
      for (const f of Array.from(files)) {
        const incomingKey = joinPrefix(INCOMING_PREFIX, f.name);
        await uploadData({ path: incomingKey, data: f }).result;
      }

      // 2) Move user to destination folder view
      setCurrentPrefix(DEST_PREFIX);

      // 3) Poll for rename/move to complete, then refresh destination listing
      //    (best-effort: if lambda is slow, user can still hit Refresh)
      for (const f of Array.from(files)) {
        await waitForRenamedFileInDest(DEST_PREFIX, f.name, 25, 1000);
      }

      await refresh(DEST_PREFIX);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onDownloadFile(path: string) {
    setError('');
    try {
      const { url } = await getUrl({ path });
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    }
  }

  async function onDeleteFile(path: string) {
    const confirmed = window.confirm(`Delete this file?\n\n${path}`);
    if (!confirmed) return;

    setLoading(true);
    setError('');
    try {
      await remove({ path });
      await refresh();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;

    const folderRel = normalizePrefix(name);
    const folderPath = joinPrefix(currentPrefix, folderRel);

    setLoading(true);
    setError('');
    try {
      await uploadData({
        path: folderPath,
        data: new Blob([''], { type: 'text/plain' }),
      }).result;

      setNewFolderName('');
      await refresh();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      {/* ====== Matt-style header (title + logged-in user + sign out on right) ====== */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>{APP_TITLE}</div>
          <div style={{ marginTop: 6, fontSize: 14, opacity: 0.8 }}>Logged in as: {userEmail || '(unknown)'}</div>
        </div>

        <Button variation="primary" onClick={() => signOut()}>
          Sign Out
        </Button>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', marginBottom: 18 }} />

      {/* ====== Breadcrumbs + current folder title ====== */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Home&nbsp;/&nbsp;
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setCurrentPrefix(ROOT);
            }}
          >
            {ROOT.replace(/\/$/, '')}
          </a>

          {breadcrumbs.map((c) => (
            <span key={c.relPrefix}>
              &nbsp;/&nbsp;
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentPrefix(joinPrefix(ROOT, c.relPrefix));
                }}
              >
                {c.label}
              </a>
            </span>
          ))}
        </div>

        <h2 style={{ marginTop: 10, marginBottom: 0 }}>{ROOT + (relativePrefix || '')}</h2>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <Button size="small" onClick={goUpOneLevel} isDisabled={currentPrefix === ROOT}>
            Back
          </Button>

          <Button size="small" onClick={() => refresh()} isLoading={loading}>
            Refresh
          </Button>

          <input ref={fileInputRef} type="file" multiple onChange={(e) => onUploadFiles(e.target.files)} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TextField
              label=""
              placeholder="New folder name (e.g. UploadedProgramFiles)"
              value={newFolderName}
              onChange={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
            />
            <Button size="small" onClick={onCreateFolder} isDisabled={loading || !newFolderName.trim()}>
              Create Folder
            </Button>
          </div>
        </div>

        {error ? (
          <div style={{ marginTop: 12, color: 'crimson', whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        ) : null}
      </div>

      {/* ====== Table ====== */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: 10 }}>Name</th>
              <th style={{ textAlign: 'left', padding: 10, width: 120 }}>Type</th>
              <th style={{ textAlign: 'left', padding: 10, width: 200 }}>Last Modified</th>
              <th style={{ textAlign: 'right', padding: 10, width: 120 }}>Size</th>
              <th style={{ textAlign: 'right', padding: 10, width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                  {loading ? 'Loading…' : 'No items found.'}
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.path} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 10 }}>
                    {it.isFolder ? (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setCurrentPrefix(it.path);
                        }}
                        style={{ fontWeight: 600 }}
                      >
                        {it.name}
                      </a>
                    ) : (
                      it.name
                    )}
                  </td>
                  <td style={{ padding: 10 }}>{it.isFolder ? 'Folder' : 'File'}</td>
                  <td style={{ padding: 10 }}>{!it.isFolder && it.lastModified ? it.lastModified.toLocaleString() : ''}</td>
                  <td style={{ padding: 10, textAlign: 'right' }}>
                    {!it.isFolder && typeof it.size === 'number' ? `${it.size.toLocaleString()} B` : ''}
                  </td>
                  <td style={{ padding: 10, textAlign: 'right' }}>
                    {it.isFolder ? (
                      <span style={{ opacity: 0.5 }}>—</span>
                    ) : (
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        <Button size="small" onClick={() => onDownloadFile(it.path)}>
                          Download
                        </Button>
                        <Button size="small" variation="destructive" onClick={() => onDeleteFile(it.path)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default withAuthenticator(Page);
