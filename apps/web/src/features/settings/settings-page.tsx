import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Bell,
  Database,
  Hash,
  Landmark,
  Plug,
  Settings2,
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
import { cn, useMediaQuery } from '@/lib/utils';
import { CategoriesSettings } from './categories-settings';
import { DataSettings } from './data-settings';
import { GeneralSettings } from './general-settings';
import { IntegrationsSettings } from './integrations-settings';
import { PayeesSettings, TagsSettings } from './labels-settings';
import { MembersSettings } from './members-settings';
import { ProfileSettings } from './profile-settings';
import { RatesSettings } from './rates-settings';

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
  | 'profile';

export function SettingsPage() {
  const search = useSearch({ from: '/app/settings' });
  const navigate = useNavigate({ from: '/settings' });
  const tab: Tab = search.tab ?? 'general';
  // A list down the side on desktop (every section in view), tabs across on smaller screens.
  const wide = useMediaQuery('(min-width: 1024px)');
  return (
    <div className="pb-10">
      <PageHeader title="Settings" />
      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ search: { tab: v as Tab }, replace: true })}
        orientation={wide ? 'vertical' : 'horizontal'}
        className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8"
      >
        <TabsList className="mb-5 flex w-full justify-start lg:sticky lg:top-8 lg:mb-0 lg:h-auto lg:flex-col lg:items-stretch lg:gap-0.5 lg:overflow-visible lg:bg-transparent lg:p-0">
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
          <SettingsTab value="notifications">
            <Bell /> Notifications
          </SettingsTab>
          <SettingsTab value="integrations">
            <Plug /> Integrations
          </SettingsTab>
          <SettingsTab value="data">
            <Database /> Data
          </SettingsTab>
          <SettingsTab value="profile">
            <UserRound /> Profile
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
