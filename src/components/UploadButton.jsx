import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from './toast.jsx';

const ACCEPT = { avatar: 'image/*', image: 'image/*', resume: 'application/pdf', pdf: 'application/pdf' };

// A small file-picker button that uploads and calls onUploaded({ url, name }).
export default function UploadButton({ kind = 'image', label = 'Upload', onUploaded }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    api.upload(file, kind)
      .then((res) => { onUploaded?.(res); toast.success('Uploaded'); })
      .catch((err) => toast.error(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Uploading…' : `⬆ ${label}`}
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT[kind] || '*/*'} hidden onChange={pick} />
    </>
  );
}
