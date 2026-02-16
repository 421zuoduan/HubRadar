import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { AmapApiError, fetchNearestHubs, type HubResult } from './src/features/hub-search/services/amap';
import { fetchCommuteInfo, type CommuteInfo } from './src/features/commute/services/amapDirection';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from './src/features/location/services/amapInputTips';
import {
  loadQueryHistory,
  saveQueryHistoryItem,
  type QueryHistoryItem,
} from './src/features/history/services/queryHistory';
import { reverseGeocode } from './src/features/location/services/amapRegeo';
import {
  buildSmartHint,
  resolveCityStrategy,
  scoreHub,
  type CityStrategy,
} from './src/features/insight/services/scoring';
import { clearAmapWebKey, loadAmapWebKey, saveAmapWebKey } from './src/features/config/services/amapKey';

type SimpleCoords = {
  latitude: number;
  longitude: number;
};

type CompareSlot = {
  id: string;
  label: string;
  departure: string | null;
};

type CompareSlotResult = {
  label: string;
  activeMinutes: number | null;
  transitMinutes: number | null;
  drivingMinutes: number | null;
};

const WHEEL_ITEM_HEIGHT = 40;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('实时定位超时，尝试使用最近一次定位'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const formatMinutes = (minutes: number | null): string => {
  if (minutes == null) {
    return '--';
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) {
    return `${mins}min`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}min`;
};

const formatDateForDisplay = (date: Date): string => {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
};

const formatDateTimeForDisplay = (date: Date): string => {
  return `${formatDateForDisplay(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const formatDateTimeForApi = (date: Date): string => {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
};

const resolveActiveModeLabel = (
  preferred: 'walking' | 'cycling',
  actual: 'walking' | 'cycling' | null | undefined,
): string => {
  if (!actual) {
    return preferred === 'walking' ? '步行' : '骑行';
  }
  if (actual === preferred) {
    return actual === 'walking' ? '步行' : '骑行';
  }
  return actual === 'walking' ? '步行(回退)' : '骑行(回退)';
};

const buildFallbackCommute = (): CommuteInfo => ({
  activeMode: null,
  activeMinutes: null,
  walkingMinutes: null,
  cyclingMinutes: null,
  transitMinutes: null,
  transitTransferCount: null,
  transitArrivalTime: null,
  drivingMinutes: null,
  drivingArrivalTime: null,
  transitSteps: [],
});

const buildCompareSlots = (): CompareSlot[] => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const morning = new Date(now);
  morning.setHours(8, 30, 0, 0);
  const morningLabel = now.getHours() < 8 ? '今天 08:30' : '明天 08:30';
  if (now.getHours() >= 8) {
    morning.setDate(now.getDate() + 1);
  }

  const evening = new Date(now);
  evening.setHours(18, 30, 0, 0);
  const eveningLabel = now.getHours() < 18 ? '今天 18:30' : '明天 18:30';
  if (now.getHours() >= 18) {
    evening.setDate(now.getDate() + 1);
  }

  return [
    { id: 'now', label: '现在', departure: null },
    { id: 'morning', label: morningLabel, departure: formatDateTimeForApi(morning) },
    { id: 'evening', label: eveningLabel, departure: formatDateTimeForApi(evening) },
    { id: 'tomorrow', label: '明天同一时刻', departure: formatDateTimeForApi(tomorrow) },
  ];
};

function CyclicNumberWheel(props: {
  value: number;
  maxExclusive: number;
  onChange: (value: number) => void;
}) {
  const { value, maxExclusive, onChange } = props;
  const listRef = useRef<FlatList<number>>(null);
  const data = useMemo(
    () => Array.from({ length: maxExclusive * 5 }, (_, index) => index % maxExclusive),
    [maxExclusive],
  );

  useEffect(() => {
    const midIndex = maxExclusive * 2 + value;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: midIndex, animated: false });
    });
  }, [maxExclusive, value]);

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT);
    const normalized = ((index % maxExclusive) + maxExclusive) % maxExclusive;
    onChange(normalized);

    if (index < maxExclusive || index > maxExclusive * 4) {
      const targetIndex = maxExclusive * 2 + normalized;
      listRef.current?.scrollToIndex({ index: targetIndex, animated: false });
    }
  };

  return (
    <View className="w-20 items-center">
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(_, idx) => `wheel-${maxExclusive}-${idx}`}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        getItemLayout={(_, index) => ({
          length: WHEEL_ITEM_HEIGHT,
          offset: WHEEL_ITEM_HEIGHT * index,
          index,
        })}
        initialNumToRender={12}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={{ height: WHEEL_ITEM_HEIGHT * 5 }}
        renderItem={({ item }) => (
          <View style={{ height: WHEEL_ITEM_HEIGHT }} className="items-center justify-center">
            <Text className="text-lg text-slate-900">{pad2(item)}</Text>
          </View>
        )}
      />
    </View>
  );
}

export default function App() {
  const [statusText, setStatusText] = useState('等待定位与查询');
  const [hubs, setHubs] = useState<HubResult[]>([]);
  const [commuteByKind, setCommuteByKind] = useState<Record<string, CommuteInfo>>({});
  const [scoreByKind, setScoreByKind] = useState<Record<string, number>>({});
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const [smartHint, setSmartHint] = useState('智能建议：等待首次查询。');
  const [isLoading, setIsLoading] = useState(false);

  const [originMode, setOriginMode] = useState<'current' | 'custom'>('current');
  const [originCoords, setOriginCoords] = useState<SimpleCoords | null>(null);
  const [originSummary, setOriginSummary] = useState('');
  const [cityStrategy, setCityStrategy] = useState<CityStrategy>(resolveCityStrategy(''));

  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<AddressSuggestion | null>(null);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [suggestionHint, setSuggestionHint] = useState('');
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedHub, setSelectedHub] = useState<HubResult | null>(null);
  const [isCompareLoading, setIsCompareLoading] = useState(false);
  const [compareResults, setCompareResults] = useState<CompareSlotResult[]>([]);
  const [amapKey, setAmapKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyHintText, setKeyHintText] = useState('');

  const [preferredActiveMode, setPreferredActiveMode] = useState<'walking' | 'cycling'>('walking');
  const [usePlannedDeparture, setUsePlannedDeparture] = useState(false);
  const [plannedDate, setPlannedDate] = useState(new Date());
  const [plannedHour, setPlannedHour] = useState(new Date().getHours());
  const [plannedMinute, setPlannedMinute] = useState(new Date().getMinutes());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const hasAmapKey = amapKey.trim().length > 0;

  const plannedDepartureAt = useMemo(() => {
    const date = new Date(plannedDate);
    date.setHours(plannedHour, plannedMinute, 0, 0);
    return date;
  }, [plannedDate, plannedHour, plannedMinute]);

  useEffect(() => {
    loadQueryHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAmapWebKey()
      .then((savedKey) => {
        if (cancelled) {
          return;
        }
        setAmapKey(savedKey);
        setKeyInput(savedKey);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAmapKey('');
        setKeyInput('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasAmapKey || originMode !== 'custom') {
      setSuggestions([]);
      setSuggestionHint('');
      return;
    }

    const keyword = addressQuery.trim();
    if (keyword.length < 2) {
      setSuggestions([]);
      setSuggestionHint('');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsSearchingSuggestions(true);
        const cityHint =
          cityStrategy.cityName && cityStrategy.cityName !== '未知城市' ? cityStrategy.cityName : undefined;
        const list = await fetchAddressSuggestions({ key: amapKey, keyword, limit: 8, city: cityHint });
        if (!cancelled) {
          setSuggestions(list);
          setSuggestionHint(list.length ? '' : '暂无候选，请补充关键词后重试');
        }
      } catch (error) {
        if (!cancelled) {
          setSuggestions([]);
          const message = error instanceof Error ? error.message : '候选查询失败，请稍后重试';
          setSuggestionHint(message);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingSuggestions(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addressQuery, amapKey, hasAmapKey, originMode, cityStrategy.cityName]);

  const resolveCurrentLocation = async (): Promise<SimpleCoords> => {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      throw new Error('手机定位服务未开启，请先开启 GPS/位置信息');
    }

    const lastKnown = await Location.getLastKnownPositionAsync({
      maxAge: 10 * 60 * 1000,
      requiredAccuracy: 3000,
    });

    try {
      const current = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
          mayShowUserSettingsDialog: true,
        }),
        12000,
      );
      return { latitude: current.coords.latitude, longitude: current.coords.longitude };
    } catch (error) {
      if (lastKnown) {
        return { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
      }
      const message = error instanceof Error ? error.message : '无法获取当前位置';
      throw new Error(message);
    }
  };

  const resolveOrigin = async (): Promise<SimpleCoords> => {
    if (originMode === 'current') {
      return resolveCurrentLocation();
    }
    if (!selectedSuggestion) {
      throw new Error('请先从候选列表中选择一个指定地点');
    }
    return { latitude: selectedSuggestion.latitude, longitude: selectedSuggestion.longitude };
  };

  const rememberOrigin = async (origin: SimpleCoords, cityName: string) => {
    const title = originMode === 'current' ? '当前位置' : selectedSuggestion?.name ?? '指定地点';
    const subtitle = originMode === 'current' ? cityName || '当前城市' : selectedSuggestion?.address ?? cityName;

    const item: QueryHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      subtitle: subtitle || '未知地址',
      latitude: origin.latitude,
      longitude: origin.longitude,
      createdAt: new Date().toISOString(),
    };

    await saveQueryHistoryItem(item);
    const list = await loadQueryHistory();
    setHistory(list);
  };

  const applyOriginFromHistory = (item: QueryHistoryItem) => {
    setOriginMode('custom');
    const suggestion: AddressSuggestion = {
      id: item.id,
      name: item.title,
      address: item.subtitle,
      latitude: item.latitude,
      longitude: item.longitude,
    };
    setSelectedSuggestion(suggestion);
    setAddressQuery(`${item.title} ${item.subtitle}`);
    setSuggestions([]);
  };

  const runCompareForHub = async (hub: HubResult) => {
    if (!originCoords) {
      setCompareResults([]);
      return;
    }
    setIsCompareLoading(true);
    try {
      const slots = buildCompareSlots();
      const result: CompareSlotResult[] = [];
      for (const slot of slots) {
        const commute = await fetchCommuteInfo({
          key: amapKey,
          originLat: originCoords.latitude,
          originLng: originCoords.longitude,
          destLat: hub.latitude,
          destLng: hub.longitude,
          preferredActiveMode,
          departureTime: slot.departure,
        });
        result.push({
          label: slot.label,
          activeMinutes: commute.activeMinutes,
          transitMinutes: commute.transitMinutes,
          drivingMinutes: commute.drivingMinutes,
        });
      }
      setCompareResults(result);
    } catch {
      setCompareResults([]);
    } finally {
      setIsCompareLoading(false);
    }
  };

  const requestSearch = async () => {
    setIsLoading(true);
    setStatusText('准备查询中...');

    try {
      if (originMode === 'current') {
        setStatusText('请求定位权限中...');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setStatusText('定位权限被拒绝');
          return;
        }
      }

      setStatusText(originMode === 'current' ? '正在获取当前位置...' : '正在读取指定地点...');
      const origin = await resolveOrigin();
      setOriginCoords(origin);

      if (!hasAmapKey) {
        setStatusText('未配置高德 Key，请先到设置页保存 Key');
        setHubs([]);
        return;
      }

      const regeo = await reverseGeocode({ key: amapKey, latitude: origin.latitude, longitude: origin.longitude });
      const cityName = regeo?.city || regeo?.district || '';
      const strategy = resolveCityStrategy(cityName);
      setCityStrategy(strategy);
      setOriginSummary(regeo?.formattedAddress ?? cityName);
      await rememberOrigin(origin, cityName);

      setStatusText('正在查询附近交通枢纽...');
      const nearestHubs = await fetchNearestHubs({ key: amapKey, latitude: origin.latitude, longitude: origin.longitude });
      if (!nearestHubs.length) {
        setHubs([]);
        setCommuteByKind({});
        setScoreByKind({});
        setStatusText('查询完成：50km 范围内未找到地铁站/火车站/机场。');
        return;
      }

      setStatusText('正在计算路线、评分与建议...');
      const commuteMap: Record<string, CommuteInfo> = {};
      for (const hub of nearestHubs) {
        try {
          commuteMap[hub.kind] = await fetchCommuteInfo({
            key: amapKey,
            originLat: origin.latitude,
            originLng: origin.longitude,
            destLat: hub.latitude,
            destLng: hub.longitude,
            preferredActiveMode,
            departureTime: usePlannedDeparture ? formatDateTimeForApi(plannedDepartureAt) : null,
          });
        } catch (commuteError) {
          if (commuteError instanceof AmapApiError && commuteError.code === '10021') {
            throw commuteError;
          }
          commuteMap[hub.kind] = buildFallbackCommute();
        }
      }

      const scoreMap: Record<string, number> = {};
      nearestHubs.forEach((hub) => {
        scoreMap[hub.kind] = scoreHub(hub, commuteMap[hub.kind], strategy);
      });
      const sorted = [...nearestHubs].sort((a, b) => scoreMap[a.kind] - scoreMap[b.kind]);

      setHubs(sorted);
      setCommuteByKind(commuteMap);
      setScoreByKind(scoreMap);
      setExpandedKind(null);
      setSelectedHub(null);
      setDetailVisible(false);
      setSmartHint(buildSmartHint({ hubs: sorted, commuteByKind: commuteMap }));
      setStatusText(`查询完成，已按综合通达度排序（城市策略：${strategy.cityName}）`);
    } catch (error) {
      let message = error instanceof Error ? error.message : '未知错误';
      if (error instanceof AmapApiError && error.code === '10021') {
        message = '高德调用过快被限流(10021)，请等待 1 分钟后重试，或在高德控制台提升 QPS 配额';
      }
      setStatusText(`查询失败: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (event.type === 'dismissed' || !selectedDate) {
      return;
    }
    setPlannedDate(selectedDate);
  };

  const onSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyHintText('请输入有效的高德 Web Key');
      return;
    }
    await saveAmapWebKey(trimmed);
    setAmapKey(trimmed);
    setKeyInput(trimmed);
    setKeyHintText('Key 已保存，后续查询将使用此 Key');
  };

  const onClearKey = async () => {
    await clearAmapWebKey();
    setAmapKey('');
    setKeyInput('');
    setKeyHintText('已清除本地 Key');
    setSuggestions([]);
    setSelectedSuggestion(null);
  };

  const openDetail = (hub: HubResult) => {
    setSelectedHub(hub);
    setDetailVisible(true);
    runCompareForHub(hub);
  };

  const keyHint = hasAmapKey
    ? '高德 Key 已配置（来自 App 本地设置）'
    : '未配置高德 Key，请在“设置”中输入并保存';

  const selectedCommute = selectedHub ? commuteByKind[selectedHub.kind] : null;

  const mapPreviewUrl = useMemo(() => {
    if (!selectedHub || !originCoords || !hasAmapKey) {
      return '';
    }
    const url = new URL('https://restapi.amap.com/v3/staticmap');
    url.search = new URLSearchParams({
      key: amapKey,
      size: '700*360',
      zoom: '11',
      markers: `mid,0x25A7FF,S:${originCoords.longitude},${originCoords.latitude}|mid,0xFF5A5F,D:${selectedHub.longitude},${selectedHub.latitude}`,
    }).toString();
    return url.toString();
  }, [amapKey, hasAmapKey, originCoords, selectedHub]);

  return (
    <>
      <ScrollView className="flex-1 bg-slate-100" contentContainerClassName="px-6 py-14">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-3xl font-bold text-slate-900">HubRadar</Text>
          <Pressable onPress={() => setSettingsVisible(true)} className="rounded-lg bg-white px-3 py-2">
            <Text className="text-slate-800">设置</Text>
          </Pressable>
        </View>

        <Text className="mb-3 text-base text-slate-600">城市交通枢纽通达度（定位 / 指定地点）</Text>
        <View className="mb-4 rounded-xl bg-white p-4">
          <Text className="text-sm text-slate-700">{keyHint}</Text>
          <Text className="mt-2 text-xs text-slate-500">
            出行偏好: {preferredActiveMode === 'walking' ? '步行优先' : '骑行优先'} | 出发时间:{' '}
            {usePlannedDeparture ? formatDateTimeForDisplay(plannedDepartureAt) : '现在'}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            城市策略: {cityStrategy.cityName}（公交权重 {Math.round(cityStrategy.transitWeight * 100)}%）
          </Text>
          {originSummary ? <Text className="mt-1 text-xs text-slate-500">起点地址: {originSummary}</Text> : null}
        </View>

        <View className="mb-4 rounded-xl bg-white p-4">
          <Text className="mb-2 text-sm font-semibold text-slate-800">查询起点</Text>
          <View className="mb-3 flex-row gap-2">
            <Pressable
              onPress={() => setOriginMode('current')}
              className={`rounded-lg px-3 py-2 ${originMode === 'current' ? 'bg-blue-600' : 'bg-slate-200'}`}
            >
              <Text className={originMode === 'current' ? 'text-white' : 'text-slate-700'}>当前位置</Text>
            </Pressable>
            <Pressable
              onPress={() => setOriginMode('custom')}
              className={`rounded-lg px-3 py-2 ${originMode === 'custom' ? 'bg-blue-600' : 'bg-slate-200'}`}
            >
              <Text className={originMode === 'custom' ? 'text-white' : 'text-slate-700'}>指定地点</Text>
            </Pressable>
          </View>

          {originMode === 'custom' ? (
            <>
              <TextInput
                value={addressQuery}
                onChangeText={(text) => {
                  setAddressQuery(text);
                  setSelectedSuggestion(null);
                  setSuggestionHint('');
                }}
                placeholder="输入地址关键词（如：上海虹桥站）"
                placeholderTextColor="#64748b"
                className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />
              {isSearchingSuggestions ? <Text className="mt-2 text-xs text-slate-500">正在搜索候选地点...</Text> : null}

              {history.length > 0 ? (
                <View className="mt-3">
                  <Text className="mb-1 text-xs text-slate-500">最近使用</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-2">
                      {history.slice(0, 5).map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => applyOriginFromHistory(item)}
                          className="rounded-full bg-slate-200 px-3 py-1.5"
                        >
                          <Text className="text-xs text-slate-700">{item.title}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              ) : null}

              {suggestions.length > 0 ? (
                <View className="mt-2 rounded-lg border border-slate-200 bg-slate-50">
                  {suggestions.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        setSelectedSuggestion(item);
                        setAddressQuery(`${item.name} ${item.address}`);
                        setSuggestions([]);
                      }}
                      className="border-b border-slate-200 px-3 py-2"
                    >
                      <Text className="text-sm font-medium text-slate-900">{item.name}</Text>
                      <Text className="text-xs text-slate-600">{item.address}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {!isSearchingSuggestions && addressQuery.trim().length >= 2 && suggestions.length === 0 && suggestionHint ? (
                <Text className="mt-2 text-xs text-amber-700">{suggestionHint}</Text>
              ) : null}

              <Text className="mt-2 text-xs text-slate-500">
                {selectedSuggestion ? `已选择: ${selectedSuggestion.name}` : '请从候选列表点选，确保经纬度精确'}
              </Text>
            </>
          ) : null}
        </View>

        <Pressable
          onPress={requestSearch}
          disabled={isLoading}
          className={`rounded-xl px-5 py-3 ${isLoading ? 'bg-blue-400' : 'bg-blue-600 active:bg-blue-700'}`}
        >
          <Text className="text-center text-base font-semibold text-white">{isLoading ? '处理中...' : '开始查询'}</Text>
        </Pressable>

        {isLoading ? (
          <View className="mt-4 flex-row items-center">
            <ActivityIndicator />
            <Text className="ml-2 text-slate-700">正在处理...</Text>
          </View>
        ) : null}

        <Text className="mt-5 text-sm text-slate-700">{statusText}</Text>
        <View className="mt-3 rounded-lg bg-amber-50 p-3">
          <Text className="text-sm text-amber-900">{smartHint}</Text>
        </View>

        <View className="mt-6 gap-3">
          {hubs.map((hub) => (
            <Pressable
              key={hub.kind}
              onPress={() => setExpandedKind((prev) => (prev === hub.kind ? null : hub.kind))}
              className="rounded-xl bg-white p-4"
            >
              <View className="flex-row justify-between">
                <View className="mr-3 flex-1">
                  <Text className="text-lg font-semibold text-slate-900">{hub.kindLabel}</Text>
                  <Text className="mt-1 text-base text-slate-800">{hub.name}</Text>
                  <Text className="mt-1 text-sm text-slate-600">{hub.address}</Text>
                  <Text className="mt-1 text-sm text-slate-700">
                    距离: {hub.distanceMeters == null ? '未知' : `${(hub.distanceMeters / 1000).toFixed(1)} km`}
                  </Text>
                  <Text className="mt-1 text-sm text-emerald-700">
                    通达度分数: {scoreByKind[hub.kind] ? scoreByKind[hub.kind].toFixed(1) : '--'}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-xs text-slate-500">
                    {resolveActiveModeLabel(preferredActiveMode, commuteByKind[hub.kind]?.activeMode)}
                  </Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMinutes(commuteByKind[hub.kind]?.activeMinutes ?? null)}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500">公交</Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMinutes(commuteByKind[hub.kind]?.transitMinutes ?? null)}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500">开车</Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMinutes(commuteByKind[hub.kind]?.drivingMinutes ?? null)}
                  </Text>
                </View>
              </View>

              {expandedKind === hub.kind ? (
                <View className="mt-3 rounded-lg bg-slate-50 p-3">
                  <View className="mb-2 flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-slate-800">公交换乘方式</Text>
                    <Pressable onPress={() => openDetail(hub)} className="rounded-md bg-blue-600 px-3 py-1.5">
                      <Text className="text-xs text-white">查看详情</Text>
                    </Pressable>
                  </View>
                  {commuteByKind[hub.kind]?.transitSteps?.length ? (
                    commuteByKind[hub.kind].transitSteps.slice(0, 4).map((step, index) => (
                      <Text key={`${hub.kind}-${index}`} className="mb-1 text-sm text-slate-700">
                        {index + 1}. {step}
                      </Text>
                    ))
                  ) : (
                    <Text className="text-sm text-slate-600">暂无换乘明细</Text>
                  )}
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={detailVisible} animationType="slide">
        <View className="flex-1 bg-slate-100 px-5 py-12">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xl font-semibold text-slate-900">枢纽详情</Text>
            <Pressable onPress={() => setDetailVisible(false)}>
              <Text className="text-slate-600">关闭</Text>
            </Pressable>
          </View>

          {selectedHub ? (
            <ScrollView>
              <Text className="text-lg font-semibold text-slate-900">{selectedHub.name}</Text>
              <Text className="mt-1 text-sm text-slate-600">{selectedHub.address}</Text>

              {mapPreviewUrl ? (
                <Image source={{ uri: mapPreviewUrl }} className="mt-3 h-44 w-full rounded-xl" resizeMode="cover" />
              ) : null}

              <View className="mt-3 rounded-xl bg-white p-4">
                <Text className="text-sm text-slate-700">
                  主动出行: {formatMinutes(selectedCommute?.activeMinutes ?? null)}
                </Text>
                <Text className="mt-1 text-sm text-slate-700">
                  公交: {formatMinutes(selectedCommute?.transitMinutes ?? null)} | 换乘 {selectedCommute?.transitTransferCount ?? '--'} 次 | 预计到达 {selectedCommute?.transitArrivalTime ?? '--'}
                </Text>
                <Text className="mt-1 text-sm text-slate-700">
                  开车: {formatMinutes(selectedCommute?.drivingMinutes ?? null)} | 预计到达 {selectedCommute?.drivingArrivalTime ?? '--'}
                </Text>
              </View>

              <View className="mt-3 rounded-xl bg-white p-4">
                <Text className="mb-2 text-sm font-semibold text-slate-800">多时段对比</Text>
                <Text className="mb-2 text-xs text-slate-500">说明：三种方式均按所选时段重算。</Text>
                {isCompareLoading ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator />
                    <Text className="ml-2 text-sm text-slate-600">计算中...</Text>
                  </View>
                ) : compareResults.length > 0 ? (
                  compareResults.map((row) => (
                    <View key={row.label} className="mb-2 rounded-lg bg-slate-50 p-2">
                      <Text className="text-xs text-slate-500">{row.label}</Text>
                      <Text className="text-sm text-slate-800">
                        主动出行 {formatMinutes(row.activeMinutes)} | 公交 {formatMinutes(row.transitMinutes)} | 开车 {formatMinutes(row.drivingMinutes)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text className="text-sm text-slate-600">暂无对比数据</Text>
                )}
              </View>

              <View className="mt-3 rounded-xl bg-white p-4">
                <Text className="mb-2 text-sm font-semibold text-slate-800">完整公交换乘步骤</Text>
                {selectedCommute?.transitSteps?.length ? (
                  selectedCommute.transitSteps.map((step, index) => (
                    <Text key={`detail-${selectedHub.kind}-${index}`} className="mb-1 text-sm text-slate-700">
                      {index + 1}. {step}
                    </Text>
                  ))
                ) : (
                  <Text className="text-sm text-slate-600">暂无换乘明细</Text>
                )}
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      <Modal visible={settingsVisible} animationType="slide" transparent>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-2xl bg-white p-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-slate-900">设置</Text>
              <Pressable onPress={() => setSettingsVisible(false)}>
                <Text className="text-slate-600">关闭</Text>
              </Pressable>
            </View>

            <Text className="mb-2 text-sm font-semibold text-slate-800">高德 Key（本地）</Text>
            <TextInput
              value={keyInput}
              onChangeText={(text) => {
                setKeyInput(text);
                setKeyHintText('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="输入你自己的高德 Web Key"
              placeholderTextColor="#64748b"
              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            />
            <View className="mb-4 mt-2 flex-row gap-2">
              <Pressable onPress={onSaveKey} className="rounded-lg bg-blue-600 px-3 py-2">
                <Text className="text-white">保存 Key</Text>
              </Pressable>
              <Pressable onPress={onClearKey} className="rounded-lg bg-slate-200 px-3 py-2">
                <Text className="text-slate-700">清除 Key</Text>
              </Pressable>
            </View>
            {keyHintText ? <Text className="mb-3 text-xs text-slate-600">{keyHintText}</Text> : null}

            <Text className="mb-2 text-sm font-semibold text-slate-800">主动出行偏好</Text>
            <View className="mb-4 flex-row gap-2">
              <Pressable
                onPress={() => setPreferredActiveMode('walking')}
                className={`rounded-lg px-3 py-2 ${preferredActiveMode === 'walking' ? 'bg-blue-600' : 'bg-slate-200'}`}
              >
                <Text className={preferredActiveMode === 'walking' ? 'text-white' : 'text-slate-700'}>步行优先</Text>
              </Pressable>
              <Pressable
                onPress={() => setPreferredActiveMode('cycling')}
                className={`rounded-lg px-3 py-2 ${preferredActiveMode === 'cycling' ? 'bg-blue-600' : 'bg-slate-200'}`}
              >
                <Text className={preferredActiveMode === 'cycling' ? 'text-white' : 'text-slate-700'}>骑行优先</Text>
              </Pressable>
            </View>

            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-slate-800">使用计划出发时间</Text>
              <Pressable
                onPress={() => setUsePlannedDeparture((v) => !v)}
                className={`rounded-lg px-3 py-1.5 ${usePlannedDeparture ? 'bg-blue-600' : 'bg-slate-200'}`}
              >
                <Text className={`text-xs ${usePlannedDeparture ? 'text-white' : 'text-slate-700'}`}>
                  {usePlannedDeparture ? '已开启' : '已关闭'}
                </Text>
              </Pressable>
            </View>

            {usePlannedDeparture ? (
              <>
                <Pressable onPress={() => setShowDatePicker(true)} className="mb-3 rounded-lg bg-slate-200 px-3 py-2">
                  <Text className="text-slate-800">选择日期: {formatDateForDisplay(plannedDate)}</Text>
                </Pressable>

                <Text className="mb-2 text-sm text-slate-700">选择时间（滚轮可循环）</Text>
                <View className="mb-2 flex-row items-center justify-center gap-3 rounded-lg bg-slate-100 py-2">
                  <CyclicNumberWheel value={plannedHour} maxExclusive={24} onChange={setPlannedHour} />
                  <Text className="text-xl text-slate-700">:</Text>
                  <CyclicNumberWheel value={plannedMinute} maxExclusive={60} onChange={setPlannedMinute} />
                </View>
                <Text className="text-xs text-slate-500">当前选择: {formatDateTimeForDisplay(plannedDepartureAt)}</Text>
                <Pressable
                  onPress={() => setSettingsVisible(false)}
                  className="mt-3 rounded-lg bg-blue-600 px-3 py-2"
                >
                  <Text className="text-center text-sm font-semibold text-white">完成</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {showDatePicker ? <DateTimePicker value={plannedDate} mode="date" display="default" onChange={onDateChange} /> : null}
    </>
  );
}
