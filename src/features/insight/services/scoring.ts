import type { HubResult } from '../../hub-search/services/amap';
import type { CommuteInfo } from '../../commute/services/amapDirection';

export type CityStrategy = {
  cityName: string;
  transitWeight: number;
  activeWeight: number;
  drivingWeight: number;
};

export const resolveCityStrategy = (cityName: string): CityStrategy => {
  const highTransitCities = ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉'];
  const fallback = {
    cityName: cityName || '未知城市',
    transitWeight: 0.45,
    activeWeight: 0.2,
    drivingWeight: 0.35,
  };

  if (highTransitCities.some((name) => cityName.includes(name))) {
    return {
      cityName: cityName || '高公交密度城市',
      transitWeight: 0.6,
      activeWeight: 0.15,
      drivingWeight: 0.25,
    };
  }
  return fallback;
};

const safeMinutes = (value: number | null): number => {
  if (value == null || Number.isNaN(value)) {
    return 180;
  }
  return Math.max(1, value);
};

export const scoreHub = (
  hub: HubResult,
  commute: CommuteInfo | undefined,
  strategy: CityStrategy,
): number => {
  const transit = safeMinutes(commute?.transitMinutes ?? null);
  const active = safeMinutes(commute?.activeMinutes ?? null);
  const driving = safeMinutes(commute?.drivingMinutes ?? null);
  const distancePenalty = ((hub.distanceMeters ?? 50000) / 1000) * 0.8;

  return (
    transit * strategy.transitWeight +
    active * strategy.activeWeight +
    driving * strategy.drivingWeight +
    distancePenalty
  );
};

export const buildSmartHint = (params: {
  hubs: HubResult[];
  commuteByKind: Record<string, CommuteInfo>;
}): string => {
  const { hubs, commuteByKind } = params;
  const airport = hubs.find((hub) => hub.kind === 'airport');
  const train = hubs.find((hub) => hub.kind === 'train');
  if (!airport || !train) {
    return '智能建议：可优先关注综合评分最低的枢纽。';
  }
  const airportTransit = commuteByKind[airport.kind]?.transitMinutes ?? 999;
  const trainTransit = commuteByKind[train.kind]?.transitMinutes ?? 999;
  if (airportTransit - trainTransit >= 40) {
    return '智能建议：当前机场公共交通明显更远，若目的地可替代，优先考虑高铁方案。';
  }
  if (trainTransit - airportTransit >= 40) {
    return '智能建议：当前火车站通达更慢，若时间紧张可优先考虑机场路线。';
  }
  return '智能建议：机场与火车站通达时间接近，可结合票价和班次决定。';
};
