export type TravelPoint = {
  assetId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  country: string | null;
  thumbnailPath: string;
};

export type TravelResponse = {
  summary: {
    start: string;
    end: string;
    rawAssetCount: number;
    geoPointCount: number;
    simplifiedPointCount: number;
  };
  points: TravelPoint[];
};
