import AsyncStorage from '@react-native-async-storage/async-storage';

export type QueryHistoryItem = {
  id: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  createdAt: string;
};

const STORAGE_KEY = 'hubradar_query_history_v1';
const MAX_ITEMS = 12;

export async function loadQueryHistory(): Promise<QueryHistoryItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as QueryHistoryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveQueryHistoryItem(item: QueryHistoryItem): Promise<void> {
  const list = await loadQueryHistory();
  const deduped = list.filter(
    (entry) =>
      !(Math.abs(entry.latitude - item.latitude) < 0.00001 && Math.abs(entry.longitude - item.longitude) < 0.00001),
  );
  const next = [item, ...deduped].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
