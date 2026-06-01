import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

import HomeScreen from '../screens/HomeScreen';
import PodcastScreen from '../screens/PodcastScreen';
import BookmarksScreen from '../screens/BookmarksScreen';
import ReadLaterScreen from '../screens/ReadLaterScreen';
import RssReaderScreen from '../screens/RssReaderScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: 'newspaper-outline',
  Podcasts: 'mic-outline',
  Bookmarks: 'bookmark-outline',
  ReadLater: 'time-outline',
  RSS: 'list-outline',
  Settings: 'settings-outline',
};

export default function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryLight,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Akış' }} />
      <Tab.Screen name="Podcasts" component={PodcastScreen} options={{ title: 'Podcast' }} />
      <Tab.Screen name="Bookmarks" component={BookmarksScreen} options={{ title: 'Kayıtlı' }} />
      <Tab.Screen name="ReadLater" component={ReadLaterScreen} options={{ title: 'Sonra' }} />
      <Tab.Screen name="RSS" component={RssReaderScreen} options={{ title: 'RSS' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Ayarlar' }} />
    </Tab.Navigator>
  );
}
