import { MAX_ATTACHMENT_BYTES } from '@et/shared';
import { Camera, FileText, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import {
  attachmentUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';

const MAX_SIDE = 2000;

/**
 * Photos are shrunk to at most 2000 px and re-encoded as JPEG before upload. Besides saving
 * space, drawing onto a canvas drops the photo's metadata (GPS location, camera details).
 */
export async function prepareFile(file: File): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif')
    return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, name: file.name };
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background, as on paper
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: `${file.name.replace(/\.[^.]+$/, '')}.jpg` };
  } catch {
    // The browser can't decode it (e.g. HEIC on Chrome); the server decides if it's acceptable.
    return { blob: file, name: file.name };
  }
}

/** Uploads files to a transaction, one after another. Returns how many succeeded. */
export async function uploadAll(
  upload: ReturnType<typeof useUploadAttachment>,
  transactionId: string,
  files: File[],
) {
  let ok = 0;
  for (const file of files) {
    try {
      const { blob, name } = await prepareFile(file);
      if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 5 MB`);
      await upload.mutateAsync({ transactionId, file: blob, name });
      ok++;
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return ok;
}

/**
 * Receipts on a transaction. Before it's saved (`transactionId` null) files are kept in
 * `queued` and uploaded by the caller once the transaction exists.
 */
export function ReceiptsField({
  transactionId,
  queued,
  onQueue,
  disabled,
}: {
  transactionId: string | null;
  queued: File[];
  onQueue: (files: File[]) => void;
  disabled?: boolean;
}) {
  const ws = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const { data: saved = [] } = useAttachments(transactionId);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();
  const [busy, setBusy] = useState(false);

  async function add(files: File[]) {
    if (files.length === 0) return;
    if (!transactionId) {
      onQueue([...queued, ...files]);
      return;
    }
    setBusy(true);
    const n = await uploadAll(upload, transactionId, files);
    setBusy(false);
    if (n) toast.success(n === 1 ? 'Receipt attached' : `${n} files attached`);
  }

  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Label>Receipts</Label>
      <div className="flex flex-wrap gap-2">
        {saved.map((a) => (
          <Thumb
            key={a.id}
            name={a.fileName}
            href={attachmentUrl(ws.id, a.id)}
            image={a.contentType.startsWith('image/')}
            onRemove={
              disabled
                ? undefined
                : () => remove.mutate(a.id, { onError: (e) => toast.error(errorMessage(e)) })
            }
          />
        ))}
        {queued.map((file) => (
          <QueuedThumb
            key={`${file.name}-${file.size}-${file.lastModified}`}
            file={file}
            onRemove={() => onQueue(queued.filter((q) => q !== file))}
          />
        ))}
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            className="h-16 w-16 flex-col gap-1 p-0 text-[11px]"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Camera />}
            Add
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          add([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function Thumb({
  name,
  href,
  image,
  onRemove,
}: {
  name: string;
  href: string;
  image: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="group relative">
      <a
        href={href}
        target="_blank"
        rel="noopener"
        title={name}
        className="grid size-16 place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground"
      >
        {image ? (
          <img src={href} alt={name} className="size-full object-cover" loading="lazy" />
        ) : (
          <span className="grid place-items-center gap-0.5 px-1 text-center text-[10px]">
            <FileText className="size-5" />
            <span className="line-clamp-1 break-all">{name}</span>
          </span>
        )}
      </a>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function QueuedThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  // Made and revoked by the same effect, so a re-run (React's development double run) gets a
  // fresh URL instead of a revoked one.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="relative">
      <div
        title={`${file.name} (uploads when you save)`}
        className="grid size-16 place-items-center overflow-hidden rounded-lg border border-dashed bg-muted text-muted-foreground"
      >
        {url ? (
          <img src={url} alt={file.name} className="size-full object-cover opacity-80" />
        ) : (
          <FileText className="size-5" />
        )}
      </div>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
