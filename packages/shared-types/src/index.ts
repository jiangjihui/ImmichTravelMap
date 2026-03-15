export type ImmichSearchAsset = {
  id: string;
  createdAt: string;
  localDateTime?: string;
  exifInfo?: {
    latitude?: number;
    longitude?: number;
    dateTimeOriginal?: string;
    city?: string;
    state?: string;
    country?: string;
  };
};

export type ImmichSearchResponse = {
  assets: {
    total: number;
    count: number;
    nextPage?: string;
    items: ImmichSearchAsset[];
  };
};

export type TravelPointBase = {
  assetId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  country: string | null;
};

export type TravelPoint = TravelPointBase & {
  thumbnailPath: string;
  assetViewUrl?: string;
};

export type TravelResponseSummary = {
  start: string;
  end: string;
  rawAssetCount: number;
  geoPointCount: number;
  simplifiedPointCount: number;
};

export type TravelPointsResult<TPoint = TravelPoint> = {
  summary: TravelResponseSummary;
  points: TPoint[];
};

export type TravelResponse = TravelPointsResult;
