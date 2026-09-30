import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Bell,
  Database,
  Hash,
  Landmark,
  Settings2,
  Tags,
  UserRound,
  Users,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '@/components/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { NotificationSettings } from '@/features/notifications/notification-settings';
import { RulesSettings } from '@/features/rules/rules-settings';
import { CategoriesSettings } from './categories-settings';
import { DataSettings } from './data-settings';
import { GeneralSettings } from './general-settings';
import { PayeesSettings, TagsSettings } from './labels-settings';
import { ProfileSettings } from './profile-settings';
import { RatesSettings } from './rates-settings';

type Tab =
  | 'general'
  | 'categories'
  | 'payees'
  | 'tags'
  | 'rules'
  | 'rates'
  | 'notifications'
  | 'data'
  | 'profile';

export function SettingsPage() {
  const search = useSearch({ from: '/app/settings' });
  const navigate = useNavigate({ from: '/settings' });
  const tab: Tab = search.tab ?? 'general';
  return (
    <div className="pb-10">
      <PageHeader title="Settings" />
      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ search: { tab: v as Tab }, replace: true })}
      >
        <TabsList className="mb-5 flex w-full justify-start">
          <TabsTrigger value="general">
            <Settings2 /> General
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tags /> Categories
          </TabsTrigger>
          <TabsTrigger value="payees">
            <Users /> Payees
          </TabsTrigger>
          <TabsTrigger value="tags">
            <Hash /> Tags
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Wand2 /> Rules
          </TabsTrigger>
          <TabsTrigger value="rates">
            <Landmark /> Exchange rates
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell /> Notifications
          </TabsTrigger>
          <TabsTrigger value="data">
            <Database /> Data
          </TabsTrigger>
          <TabsTrigger value="profile">
            <UserRound /> Profile
          </TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
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
