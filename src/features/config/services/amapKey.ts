import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hubradar_amap_web_key_v1';

export async function loadAmapWebKey(): Promise<string> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  return (value ?? '').trim();
}

export async function saveAmapWebKey(key: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, key.trim());
}

export async function clearAmapWebKey(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
