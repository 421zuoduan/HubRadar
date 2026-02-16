import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { AmapApiError, fetchNearestHubs, type HubResult } from './src/features/hub-search/services/amap';
import { fetchCommuteInfo, type CommuteInfo } from './src/features/commute/services/amapDirection';
import {
  fetchAddressSuggestions,
  type AddressSuggestion,
} from './src/features/location/services/amapInputTips';

type SimpleCoords = {
  latitude: number;
  longitude: number;
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
        getItemLayout={(_, index) => ({
          length: WHEEL_ITEM_HEIGHT,
          offset: WHEEL_ITEM_HEIGHT * index,
          index,
        })}
        initialNumToRender={12}
        onMomentumScrollEnd={onMomentumScrollEnd}
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
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [originMode, setOriginMode] = useState<'current' | 'custom'>('current');
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<AddressSuggestion | null>(null);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [preferredActiveMode, setPreferredActiveMode] = useState<'walking' | 'cycling'>('walking');
  const [usePlannedDeparture, setUsePlannedDeparture] = useState(false);
  const [plannedDate, setPlannedDate] = useState(new Date());
  const [plannedHour, setPlannedHour] = useState(new Date().getHours());
  const [plannedMinute, setPlannedMinute] = useState(new Date().getMinutes());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const amapKey = process.env.EXPO_PUBLIC_AMAP_WEB_KEY ?? '';
  const hasAmapKey = amapKey.trim().length > 0;

  const plannedDepartureAt = useMemo(() => {
    const date = new Date(plannedDate);
    date.setHours(plannedHour, plannedMinute, 0, 0);
    return date;
  }, [plannedDate, plannedHour, plannedMinute]);

  useEffect(() => {
    if (!hasAmapKey || originMode !== 'custom') {
      setSuggestions([]);
      return;
    }

    const keyword = addressQuery.trim();
    if (keyword.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsSearchingSuggestions(true);
        const list = await fetchAddressSuggestions({
          key: amapKey,
          keyword,
          limit: 8,
        });
        if (!cancelled) {
          setSuggestions(list);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingSuggestions(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addressQuery, amapKey, hasAmapKey, originMode]);

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
      return {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      };
    } catch (error) {
      if (lastKnown) {
        return {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
        };
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
    return {
      latitude: selectedSuggestion.latitude,
      longitude: selectedSuggestion.longitude,
    };
  };

  const requestSearch = async () => {
    setIsLoading(true);
    setStatusText('准备查询中...');

    try {
      let origin: SimpleCoords;
      if (originMode === 'current') {
        setStatusText('请求定位权限中...');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setStatusText('定位权限被拒绝');
          return;
        }
      }

      setStatusText(originMode === 'current' ? '正在获取当前位置...' : '正在读取指定地点...');
      origin = await resolveOrigin();

      if (!hasAmapKey) {
        setStatusText('未检测到 EXPO_PUBLIC_AMAP_WEB_KEY');
        setHubs([]);
        return;
      }

      setStatusText('正在查询附近交通枢纽...');
      const nearestHubs = await fetchNearestHubs({
        key: amapKey,
        latitude: origin.latitude,
        longitude: origin.longitude,
      });
      const sorted = nearestHubs.sort((a, b) => (a.distanceMeters ?? 999999) - (b.distanceMeters ?? 999999));

      setHubs(sorted);
      setCommuteByKind({});
      setExpandedKind(null);

      if (sorted.length === 0) {
        setStatusText('查询完成：50km 范围内未找到地铁站/火车站/机场，请检查定位、城市与 Key 权限');
        return;
      }

      setStatusText('正在计算步行/骑行/公交/开车时间...');
      const nextCommuteByKind: Record<string, CommuteInfo> = {};
      for (const hub of sorted) {
        try {
          const commute = await fetchCommuteInfo({
            key: amapKey,
            originLat: origin.latitude,
            originLng: origin.longitude,
            destLat: hub.latitude,
            destLng: hub.longitude,
            preferredActiveMode,
            departureTime: usePlannedDeparture ? formatDateTimeForApi(plannedDepartureAt) : null,
          });
          nextCommuteByKind[hub.kind] = commute;
          setCommuteByKind({ ...nextCommuteByKind });
        } catch (commuteError) {
          if (commuteError instanceof AmapApiError && commuteError.code === '10021') {
            throw commuteError;
          }
          nextCommuteByKind[hub.kind] = {
            activeMode: null,
            activeMinutes: null,
            walkingMinutes: null,
            cyclingMinutes: null,
            transitMinutes: null,
            drivingMinutes: null,
            transitSteps: [],
          };
        }
      }

      setStatusText(`查询完成，共 ${sorted.length} 个枢纽类型有结果`);
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

  const keyHint = hasAmapKey
    ? '高德 Key 已读取'
    : '请在 .env 中设置 EXPO_PUBLIC_AMAP_WEB_KEY 并重启 Expo';

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
                }}
                placeholder="输入地址关键词（如：上海虹桥站）"
                placeholderTextColor="#64748b"
                className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />
              {isSearchingSuggestions ? (
                <Text className="mt-2 text-xs text-slate-500">正在搜索候选地点...</Text>
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
              <Text className="mt-2 text-xs text-slate-500">
                {selectedSuggestion
                  ? `已选择: ${selectedSuggestion.name}`
                  : '请从候选列表点选，确保经纬度精确'}
              </Text>
            </>
          ) : null}
        </View>

        <Pressable
          onPress={requestSearch}
          disabled={isLoading}
          className={`rounded-xl px-5 py-3 ${isLoading ? 'bg-blue-400' : 'bg-blue-600 active:bg-blue-700'}`}
        >
          <Text className="text-center text-base font-semibold text-white">
            {isLoading ? '处理中...' : '开始查询'}
          </Text>
        </Pressable>

        {isLoading ? (
          <View className="mt-4 flex-row items-center">
            <ActivityIndicator />
            <Text className="ml-2 text-slate-700">正在处理...</Text>
          </View>
        ) : null}

        <Text className="mt-5 text-sm text-slate-700">{statusText}</Text>

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
                  <Text className="mb-2 text-sm font-semibold text-slate-800">公交换乘方式</Text>
                  {commuteByKind[hub.kind]?.transitSteps?.length ? (
                    commuteByKind[hub.kind].transitSteps.map((step, index) => (
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

      <Modal visible={settingsVisible} animationType="slide" transparent>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-2xl bg-white p-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-slate-900">设置</Text>
              <Pressable onPress={() => setSettingsVisible(false)}>
                <Text className="text-slate-600">关闭</Text>
              </Pressable>
            </View>

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
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  className="mb-3 rounded-lg bg-slate-200 px-3 py-2"
                >
                  <Text className="text-slate-800">选择日期: {formatDateForDisplay(plannedDate)}</Text>
                </Pressable>

                <Text className="mb-2 text-sm text-slate-700">选择时间（滚轮可循环）</Text>
                <View className="mb-2 flex-row items-center justify-center gap-3 rounded-lg bg-slate-100 py-2">
                  <CyclicNumberWheel value={plannedHour} maxExclusive={24} onChange={setPlannedHour} />
                  <Text className="text-xl text-slate-700">:</Text>
                  <CyclicNumberWheel value={plannedMinute} maxExclusive={60} onChange={setPlannedMinute} />
                </View>
                <Text className="text-xs text-slate-500">
                  当前选择: {formatDateTimeForDisplay(plannedDepartureAt)}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {showDatePicker ? (
        <DateTimePicker
          value={plannedDate}
          mode="date"
          display="default"
          onChange={onDateChange}
        />
      ) : null}
    </>
  );
}
