import { MAX_ATTACHMENT_BYTES } from '@et/shared';
import { FileText, ImagePlus, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Label } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import {
  attachmentUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

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

  // Dragging files over the dialog: the zone lights up; a drop elsewhere mustn't open the file
  // in the tab (and lose the form).
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    if (disabled) return;
    const keep = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', keep);
    window.addEventListener('drop', keep);
    return () => {
      window.removeEventListener('dragover', keep);
      window.removeEventListener('drop', keep);
    };
  }, [disabled]);

  function accept(files: File[]) {
    const usable = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (usable.length < files.length) toast.error('Only photos and PDFs can be attached');
    void add(usable);
  }

  const count = saved.length + queued.length;
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <Label>Receipts</Label>
      {count > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
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
        </div>
      )}
      {!disabled && (
        <button
          id="receipts-add"
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            depth.current++;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            depth.current = 0;
            setDragging(false);
            accept([...e.dataTransfer.files]);
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 text-left transition-colors focus-visible:border-primary disabled:opacity-60',
            count > 0 ? 'py-2.5' : 'py-4',
            dragging
              ? 'border-primary bg-accent text-accent-foreground'
              : 'border-input bg-muted/30 hover:border-primary/50 hover:bg-muted/60',
          )}
        >
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-full bg-accent text-accent-foreground',
              count > 0 ? 'size-8' : 'size-10',
            )}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ImagePlus className={count > 0 ? 'size-4' : 'size-5'} />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {busy
                ? 'Uploading…'
                : dragging
                  ? 'Drop to attach'
                  : count > 0
                    ? 'Add another receipt'
                    : 'Add a receipt'}
            </span>
            {count === 0 && !dragging && (
              <span className="block text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  Drag a photo or PDF here, or click to choose.{' '}
                </span>
                <span className="sm:hidden">Take a photo or choose a file. </span>
                JPG, PNG or PDF, up to 5 MB.
              </span>
            )}
          </span>
        </button>
      )}
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
          <span className="grid place-items-center gap-0.5 px-1 text-center text-2xs">
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
