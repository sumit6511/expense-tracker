import { CheckIcon } from 'lucide-react';
import {
  Checkbox as CheckboxPrimitive,
  DropdownMenu as MenuPrimitive,
  Popover as PopoverPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
  Tooltip as TooltipPrimitive,
} from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Every surface that floats over the page: menus, selects, pickers, popovers. */
export const floating =
  'z-50 rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in';

/**
 * A row in any floating list: dropdown menus, selects and the searchable pickers (cmdk). The row
 * under the pointer or keyboard gets the same teal tint as the active page in the sidebar.
 */
export const menuItem =
  'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0';

/** A group heading inside a floating list. */
export const menuLabel =
  'px-2.5 pt-2 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase';

/** For cmdk lists: styles its group headings like `menuLabel`. */
export const commandGroups =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase';

// Dropdown menu -------------------------------------------------------------------------------

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(floating, 'min-w-44 p-1', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        menuItem,
        '[&_svg]:size-4 [&_svg]:text-muted-foreground data-[highlighted]:[&_svg]:text-accent-foreground',
        destructive &&
          'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg]:text-destructive data-[highlighted]:[&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2.5 py-1.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-border" />;
}

// Popover ------------------------------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(floating, 'w-72 p-3', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// Tabs ---------------------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-10 items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

// Checkbox & switch ---------------------------------------------------------------------------

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer grid grid-cols-1 size-[18px] shrink-0 place-items-center rounded-[5px] border border-input bg-card shadow-xs transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-6 w-10 shrink-0 items-center rounded-full border-2 border-transparent bg-input transition-colors data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

// Tooltip -------------------------------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md data-[state=delayed-open]:animate-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * A small status icon (needs review, attachment, reconciled…) with its meaning shown on hover and
 * read out as its name. Not focusable, so it can sit inside a clickable row.
 */
export function Hint({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip content={label}>
      <span role="img" aria-label={label} className={cn('inline-flex shrink-0', className)}>
        {children}
      </span>
    </Tooltip>
  );
}

// Segmented control ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  label,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      className={cn(
        // Equal columns sized to the longest label: no wrapping when there's room, an even split
        // at full width, and balanced wrapping only on screens too narrow for the labels.
        'inline-grid min-w-0 auto-cols-fr grid-flow-col rounded-lg bg-muted p-1',
        disabled && 'opacity-60',
        className,
      )}
    >
      {label && <legend className="sr-only">{label}</legend>}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md leading-tight font-medium text-balance text-muted-foreground transition-colors hover:text-foreground',
            size === 'md' ? 'min-h-8 px-3 py-1 text-sm' : 'min-h-7 px-2.5 py-1 text-xs',
            value === o.value && 'bg-card text-foreground shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
