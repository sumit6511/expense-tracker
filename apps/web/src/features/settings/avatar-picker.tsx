import { AVATAR_PRESETS, type AvatarPreset, MAX_AVATAR_BYTES } from '@et/shared';
import { Check, ImagePlus, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AVATAR_LOOKS, UserAvatar } from '@/components/person';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useUpdateMe, useUploadAvatar } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const SIDE = 256;

/**
 * A photo cropped to its centre square and shrunk to 256 × 256 (WebP, or JPEG where the browser
 * can't write WebP). Drawing it again also drops the photo's metadata, such as its location.
 */
async function squarePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This photo can’t be read here. Use a JPG or PNG.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t prepare the photo');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIDE, SIDE);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIDE,
    SIDE,
  );
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode('image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  if (!blob) throw new Error('This browser can’t prepare the photo');
  if (blob.size > MAX_AVATAR_BYTES) throw new Error('The photo is too large');
  return blob;
}

type Choice =
  | { kind: 'preset'; key: AvatarPreset }
  | { kind: 'none' }
  | { kind: 'photo'; blob: Blob };

/** The picture on the profile card, with buttons to change or remove it. */
export function ProfilePicture() {
  const { me } = useSession();
  const updateMe = useUpdateMe();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <UserAvatar id={me.user.id} name={me.user.name} avatar={me.user.avatar} size="xl" />
      <div className="grid grid-cols-1 gap-2">
        <p className="text-xs text-muted-foreground">Shown to people you share a workspace with.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Change picture
          </Button>
          {me.user.avatar && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={updateMe.isPending}
              onClick={() =>
                updateMe.mutate(
                  { avatar: null },
                  {
                    onSuccess: () => toast.success('Picture removed'),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                )
              }
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <PictureDialog onDone={() => setOpen(false)} />}
      </Dialog>
    </div>
  );
}

function PictureDialog({ onDone }: { onDone: () => void }) {
  const { me } = useSession();
  const updateMe = useUpdateMe();
  const upload = useUploadAvatar();
  const current = me.user.avatar;
  const [tab, setTab] = useState<'avatars' | 'photo'>(
    current && !current.startsWith('preset:') ? 'photo' : 'avatars',
  );
  const [choice, setChoice] = useState<Choice | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saving = updateMe.isPending || upload.isPending;

  // A preview of the photo they picked.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (choice?.kind !== 'photo') return;
    const url = URL.createObjectURL(choice.blob);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [choice]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose a photo (JPG, PNG or WebP)');
      return;
    }
    setPreparing(true);
    try {
      setChoice({ kind: 'photo', blob: await squarePhoto(file) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPreparing(false);
    }
  }

  const preview =
    choice?.kind === 'preset'
      ? `preset:${choice.key}`
      : choice?.kind === 'none'
        ? null
        : choice?.kind === 'photo'
          ? photoUrl
          : current;
  const selectedPreset =
    choice?.kind === 'preset'
      ? choice.key
      : !choice && current?.startsWith('preset:')
        ? current.slice('preset:'.length)
        : null;
  const noneSelected = choice?.kind === 'none' || (!choice && !current);

  function save() {
    if (!choice) return onDone();
    const done = {
      onSuccess: () => {
        toast.success('Picture updated');
        onDone();
      },
      onError: (e: unknown) => toast.error(errorMessage(e)),
    };
    if (choice.kind === 'photo') upload.mutate(choice.blob, done);
    else updateMe.mutate({ avatar: choice.kind === 'none' ? null : `preset:${choice.key}` }, done);
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Profile picture</DialogTitle>
        <DialogDescription>Choose an avatar or use a photo of yourself.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid grid-cols-1 gap-4">
        <div className="flex justify-center pt-1">
          <UserAvatar
            id={me.user.id}
            name={me.user.name}
            avatar={preview}
            size="xl"
            label="Preview"
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="avatars" className="justify-center">
              Avatars
            </TabsTrigger>
            <TabsTrigger value="photo" className="justify-center">
              Photo
            </TabsTrigger>
          </TabsList>
          <TabsContent value="avatars" className="pt-4">
            <fieldset className="grid grid-cols-5 gap-3 sm:grid-cols-6">
              <legend className="sr-only">Avatars</legend>
              <AvatarOption
                selected={noneSelected}
                label="Initials"
                onSelect={() => setChoice({ kind: 'none' })}
              >
                <UserAvatar id={me.user.id} name={me.user.name} avatar={null} size="lg" />
              </AvatarOption>
              {AVATAR_PRESETS.map((key) => (
                <AvatarOption
                  key={key}
                  selected={selectedPreset === key}
                  label={AVATAR_LOOKS[key].label}
                  onSelect={() => setChoice({ kind: 'preset', key })}
                >
                  <UserAvatar
                    id={me.user.id}
                    name={me.user.name}
                    avatar={`preset:${key}`}
                    size="lg"
                  />
                </AvatarOption>
              ))}
            </fieldset>
          </TabsContent>
          <TabsContent value="photo" className="pt-4">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={preparing}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void pickFile(e.dataTransfer.files[0]);
              }}
              className={cn(
                'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:border-primary',
                dragging
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-input bg-muted/30 hover:border-primary/50 hover:bg-muted/60',
              )}
            >
              <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground">
                {preparing ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <ImagePlus className="size-5" />
                )}
              </span>
              <span className="text-sm font-medium">
                {dragging
                  ? 'Drop to use this photo'
                  : choice?.kind === 'photo'
                    ? 'Choose a different photo'
                    : 'Upload a photo'}
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="hidden sm:inline">Drag it here or click to choose. </span>
                It’s cropped to a square around the middle.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              hidden
              onChange={(e) => {
                void pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={saving || preparing || !choice}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AvatarOption({
  selected,
  label,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        'relative grid place-items-center justify-self-center rounded-full p-1 transition-shadow',
        selected ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-border',
      )}
    >
      {children}
      {selected && (
        <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
