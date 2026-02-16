import { AmapApiError } from '../../hub-search/services/amap';

export type CommuteInfo = {
  activeMode: 'walking' | 'cycling' | null;
  activeMinutes: number | null;
  walkingMinutes: number | null;
  cyclingMinutes: number | null;
  transitMinutes: number | null;
  drivingMinutes: number | null;
  transitSteps: string[];
};

type TransitSegment = {
  walking?: { duration?: string; steps?: Array<{ instruction?: string }> };
  bus?: {
    buslines?: Array<{
      name?: string;
      duration?: string;
      departure_stop?: { name?: string };
      arrival_stop?: { name?: string };
    }>;
  };
};

const MIN_REQUEST_INTERVAL_MS = 350;
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const throttleAmapRequest = async () => {
  const now = Date.now();
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestAt));
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
};

const toMinutes = (durationSeconds?: string): number | null => {
  if (!durationSeconds) {
    return null;
  }
  const value = Number(durationSeconds);
  if (Number.isNaN(value)) {
    return null;
  }
  return Math.max(1, Math.round(value / 60));
};

const amapGetJson = async (url: URL): Promise<any> => {
  await throttleAmapRequest();
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new AmapApiError(`高德请求失败: ${response.status}`);
  }
  const json = await response.json();
  if (json?.status !== '1') {
    throw new AmapApiError(
      `高德接口错误: ${json?.info ?? 'unknown'} (${json?.infocode ?? 'n/a'})`,
      json?.infocode,
    );
  }
  return json;
};

const amapGetCyclingJson = async (url: URL): Promise<any> => {
  await throttleAmapRequest();
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new AmapApiError(`高德请求失败: ${response.status}`);
  }
  const json = await response.json();
  if (json?.errcode && String(json.errcode) !== '0') {
    throw new AmapApiError(
      `高德接口错误: ${json?.errmsg ?? 'unknown'} (${json?.errcode ?? 'n/a'})`,
      String(json?.errcode),
    );
  }
  return json;
};

const formatDurationLabel = (minutes: number | null): string => {
  if (minutes == null) {
    return '未知时长';
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

const parseTransitSteps = (segments: TransitSegment[] | undefined): string[] => {
  if (!segments?.length) {
    return [];
  }
  const steps: string[] = [];

  segments.forEach((segment) => {
    const walkingSegmentMinutes = toMinutes(segment.walking?.duration);
    const walkingHint = segment.walking?.steps?.[0]?.instruction;
    if (walkingSegmentMinutes != null || walkingHint) {
      const durationPart =
        walkingSegmentMinutes == null ? '步行' : `步行 ${formatDurationLabel(walkingSegmentMinutes)}`;
      const hintPart = walkingHint ? `: ${walkingHint}` : '';
      steps.push(`${durationPart}${hintPart}`);
    }

    segment.bus?.buslines?.forEach((line) => {
      const lineName = line.name?.split('(')[0]?.trim() || '公交线路';
      const dep = line.departure_stop?.name ?? '上车站';
      const arr = line.arrival_stop?.name ?? '下车站';
      const lineMinutes = toMinutes(line.duration);
      steps.push(`${lineName}: ${dep} -> ${arr} (${formatDurationLabel(lineMinutes)})`);
    });
  });

  return steps.slice(0, 12);
};

export async function fetchCommuteInfo(params: {
  key: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  preferredActiveMode?: 'walking' | 'cycling';
  departureTime?: string | null;
}): Promise<CommuteInfo> {
  const {
    key,
    originLat,
    originLng,
    destLat,
    destLng,
    preferredActiveMode = 'walking',
    departureTime,
  } = params;
  const origin = `${originLng},${originLat}`;
  const destination = `${destLng},${destLat}`;

  const walkingUrl = new URL('https://restapi.amap.com/v3/direction/walking');
  walkingUrl.search = new URLSearchParams({ key, origin, destination }).toString();
  const walkingJson = await amapGetJson(walkingUrl);
  const walkingMinutes = toMinutes(walkingJson?.route?.paths?.[0]?.duration);

  const cyclingUrl = new URL('https://restapi.amap.com/v4/direction/bicycling');
  cyclingUrl.search = new URLSearchParams({ key, origin, destination }).toString();
  const cyclingJson = await amapGetCyclingJson(cyclingUrl);
  const cyclingMinutes = toMinutes(cyclingJson?.data?.paths?.[0]?.duration);

  const transitUrl = new URL('https://restapi.amap.com/v3/direction/transit/integrated');
  const transitParams = new URLSearchParams({
    key,
    origin,
    destination,
    strategy: '0',
    nightflag: '1',
  });
  if (departureTime) {
    const [date, time] = departureTime.split(' ');
    if (date && time) {
      transitParams.set('date', date);
      transitParams.set('time', time);
    }
  }
  transitUrl.search = transitParams.toString();
  const transitJson = await amapGetJson(transitUrl);
  const transit = transitJson?.route?.transits?.[0];
  const transitMinutes = toMinutes(transit?.duration);
  const transitSteps = parseTransitSteps(transit?.segments);

  const drivingUrl = new URL('https://restapi.amap.com/v3/direction/driving');
  drivingUrl.search = new URLSearchParams({
    key,
    origin,
    destination,
    strategy: '0',
    extensions: 'base',
  }).toString();
  const drivingJson = await amapGetJson(drivingUrl);
  const drivingMinutes = toMinutes(drivingJson?.route?.paths?.[0]?.duration);

  let activeMode: 'walking' | 'cycling' | null = null;
  let activeMinutes: number | null = null;
  if (preferredActiveMode === 'walking') {
    activeMode = walkingMinutes != null ? 'walking' : cyclingMinutes != null ? 'cycling' : null;
    activeMinutes = walkingMinutes ?? cyclingMinutes;
  } else {
    activeMode = cyclingMinutes != null ? 'cycling' : walkingMinutes != null ? 'walking' : null;
    activeMinutes = cyclingMinutes ?? walkingMinutes;
  }

  return {
    activeMode,
    activeMinutes,
    walkingMinutes,
    cyclingMinutes,
    transitMinutes,
    drivingMinutes,
    transitSteps,
  };
}
