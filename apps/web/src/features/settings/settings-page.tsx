import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Bell,
  Database,
  Hash,
  Landmark,
  Plug,
  Settings2,
  ShieldCheck,
  Tags,
  UserRound,
  Users,
  UsersRound,
  Wand2,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { NotificationSettings } from '@/features/notifications/notification-settings';
import { RulesSettings } from '@/features/rules/rules-settings';
import { cn, edgeFade, revealActive, useMediaQuery } from '@/lib/utils';
import { CategoriesSettings } from './categories-settings';
import { DataSettings } from './data-settings';
import { GeneralSettings } from './general-settings';
import { IntegrationsSettings } from './integrations-settings';
import { PayeesSettings, TagsSettings } from './labels-settings';
import { MembersSettings } from './members-settings';
import { ProfileSettings } from './profile-settings';
import { RatesSettings } from './rates-settings';
import { SecuritySettings } from './security-settings';

type Tab =
  | 'general'
  | 'members'
  | 'categories'
  | 'payees'
  | 'tags'
  | 'rules'
  | 'rates'
  | 'notifications'
  | 'integrations'
  | 'data'
  | 'profile'
  | 'security';

const TAB_TITLES: Record<Tab, string> = {
  general: 'General',
  members: 'Members',
  categories: 'Categories',
  payees: 'Payees',
  tags: 'Tags',
  rules: 'Rules',
  rates: 'Exchange rates',
  notifications: 'Notifications',
  integrations: 'Integrations',
  data: 'Data',
  profile: 'Profile',
  security: 'Security',
};

export function SettingsPage() {
  const search = useSearch({ from: '/app/settings' });
  const navigate = useNavigate({ from: '/settings' });
  const tab: Tab = search.tab ?? 'general';
  // A list down the side on desktop (every section in view), tabs across on smaller screens.
  const wide = useMediaQuery('(min-width: 1024px)');
  return (
    <div className="pb-10">
      <PageHeader title="Settings" documentTitle={`${TAB_TITLES[tab]} · Settings`} />
      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ search: { tab: v as Tab }, replace: true })}
        orientation={wide ? 'vertical' : 'horizontal'}
        className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8"
      >
        <TabsList
          // Phones: keep the chosen tab in view in the row.
          ref={(el) => {
            revealActive(el);
            return edgeFade(el);
          }}
          className="edge-fade mb-5 flex w-full justify-start lg:sticky lg:top-8 lg:mb-0 lg:h-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible lg:bg-transparent lg:p-0 lg:[mask-image:none]"
        >
          {/* The workspace everyone shares, then what's yours alone. */}
          <NavGroup label="Workspace" first />
          <SettingsTab value="general">
            <Settings2 /> General
          </SettingsTab>
          <SettingsTab value="members">
            <UsersRound /> Members
          </SettingsTab>
          <SettingsTab value="categories">
            <Tags /> Categories
          </SettingsTab>
          <SettingsTab value="payees">
            <Users /> Payees
          </SettingsTab>
          <SettingsTab value="tags">
            <Hash /> Tags
          </SettingsTab>
          <SettingsTab value="rules">
            <Wand2 /> Rules
          </SettingsTab>
          <SettingsTab value="rates">
            <Landmark /> Exchange rates
          </SettingsTab>
          <SettingsTab value="integrations">
            <Plug /> Integrations
          </SettingsTab>
          <SettingsTab value="data">
            <Database /> Data
          </SettingsTab>
          <NavGroup label="You" />
          <SettingsTab value="profile">
            <UserRound /> Profile
          </SettingsTab>
          <SettingsTab value="security">
            <ShieldCheck /> Security
          </SettingsTab>
          <SettingsTab value="notifications">
            <Bell /> Notifications
          </SettingsTab>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="members">
          <MembersSettings />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesSettings />
        </TabsContent>
        <TabsContent value="payees">
          <PayeesSettings />
        </TabsContent>
        <TabsContent value="tags">
          <TagsSettings />
        </TabsContent>
        <TabsContent value="rules">
          <RulesSettings />
        </TabsContent>
        <TabsContent value="rates">
          <RatesSettings />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsSettings />
        </TabsContent>
        <TabsContent value="data">
          <DataSettings />
        </TabsContent>
        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** On desktop, styled like the main navigation in the sidebar. */
function SettingsTab({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        'lg:h-9 lg:justify-start lg:gap-2.5 lg:px-3 lg:hover:bg-muted lg:data-[state=active]:bg-accent lg:data-[state=active]:text-accent-foreground lg:data-[state=active]:shadow-none lg:[&_svg]:size-[18px]',
        className,
      )}
      {...props}
    />
  );
}

/** A heading over a group in the desktop list; a divider between groups in the row of tabs. */
function NavGroup({ label, first }: { label: string; first?: boolean }) {
  return (
    <>
      {!first && (
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 self-center bg-border lg:hidden" />
      )}
      <span
        role="presentation"
        className={cn(
          'hidden px-3 pb-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase lg:block',
          first ? 'pt-0' : 'pt-5',
        )}
      >
        {label}
      </span>
    </>
  );
}
