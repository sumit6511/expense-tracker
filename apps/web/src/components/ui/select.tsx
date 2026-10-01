import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Children, type ComponentProps, isValidElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fieldBase } from './input';
import { floating, menuItem, menuLabel } from './menu';

/*
 * A select that looks like the rest of the app in light and dark mode (a native <select> opens
 * the operating system's list, which ignores the theme). Values are strings; an item whose value
 * is '' is fine here ("All accounts"), though Radix itself doesn't allow it.
 */

const EMPTY = '\u0000empty';
const toRadix = (value: string) => (value === '' ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? '' : value);

/** Whether one of the items (or items in a group) has the value ''. */
function hasEmptyItem(children: ReactNode): boolean {
  return Children.toArray(children).some(
    (child) =>
      isValidElement<{ value?: string; children?: ReactNode }>(child) &&
      (child.type === SelectItem
        ? child.props.value === ''
        : child.type === SelectGroup && hasEmptyItem(child.props.children)),
  );
}

export function Select({
  value,
  onValueChange,
  placeholder,
  children,
  className,
  contentClassName,
  disabled,
  required,
  name,
  ...props
}: Omit<ComponentProps<typeof SelectPrimitive.Trigger>, 'value' | 'children' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Shown while nothing is chosen. */
  placeholder?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  required?: boolean;
  name?: string;
}) {
  // Radix shows the placeholder only for '', so '' stays '' unless an item stands for it.
  const radixValue = value === '' && !hasEmptyItem(children) ? '' : toRadix(value);
  return (
    <SelectPrimitive.Root
      value={radixValue}
      onValueChange={(v) => onValueChange(fromRadix(v))}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectPrimitive.Trigger
        className={cn(
          fieldBase,
          'group flex h-10 items-center gap-2 text-left whitespace-nowrap data-[placeholder]:text-muted-foreground data-[state=open]:ring-3 data-[state=open]:ring-ring',
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="-mr-1 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={6}
          className={cn(
            floating,
            'relative max-h-[min(var(--radix-select-content-available-height),24rem)] max-w-[calc(100vw-1rem)] min-w-[max(var(--radix-select-trigger-width),8rem)] overflow-hidden',
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SelectItem({
  value,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SelectPrimitive.Item>, 'value'> & { value: string }) {
  return (
    <SelectPrimitive.Item
      value={toRadix(value)}
      className={cn(menuItem, 'relative pr-8', className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center text-primary">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export function SelectGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <SelectPrimitive.Group>
      <SelectPrimitive.Label className={menuLabel}>{label}</SelectPrimitive.Label>
      {children}
    </SelectPrimitive.Group>
  );
}
