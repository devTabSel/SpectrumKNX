import type { Telegram } from '../hooks/useWebSocket';
import { getPref, setPref } from './prefs';

export type SourceColumnField =
  | 'address'
  | 'name'
  | 'manufacturer'
  | 'hardware'
  | 'locationName'
  | 'locationType'
  | 'locationPath';

export interface SourceColumnLineConfig {
  top: SourceColumnField;
  bottom: SourceColumnField;
}

export interface SourceDeviceMetadata {
  deviceName: string;
  manufacturer: string;
  hardware: string;
  locationName: string;
  locationType: string;
  locationPath: string;
}

interface BuildingDeviceNode {
  address: string;
  name: string;
  manufacturer: string;
  hardware: string;
}

interface BuildingSpaceNode {
  type: string;
  name: string;
  spaces: BuildingSpaceNode[];
  devices: BuildingDeviceNode[];
}

export const SOURCE_COLUMN_FIELD_OPTIONS: Array<{ value: SourceColumnField; label: string }> = [
  { value: 'address', label: 'Device Address' },
  { value: 'name', label: 'Device Name' },
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'locationName', label: 'Location Name' },
  { value: 'locationType', label: 'Location Type' },
  { value: 'locationPath', label: 'Location PATH' },
];

export const DEFAULT_SOURCE_COLUMN_LINE_CONFIG: SourceColumnLineConfig = {
  top: 'address',
  bottom: 'name',
};

const sourceColumnConfigKey = 'sourceColumnConfig';

const isSourceColumnField = (value: unknown): value is SourceColumnField =>
  SOURCE_COLUMN_FIELD_OPTIONS.some(option => option.value === value);

export const readSourceColumnConfigPref = (): SourceColumnLineConfig => {
  try {
    const raw = getPref(sourceColumnConfigKey);
    if (!raw) return { ...DEFAULT_SOURCE_COLUMN_LINE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SourceColumnLineConfig>;
    return {
      top: isSourceColumnField(parsed.top) ? parsed.top : DEFAULT_SOURCE_COLUMN_LINE_CONFIG.top,
      bottom: isSourceColumnField(parsed.bottom) ? parsed.bottom : DEFAULT_SOURCE_COLUMN_LINE_CONFIG.bottom,
    };
  } catch {
    return { ...DEFAULT_SOURCE_COLUMN_LINE_CONFIG };
  }
};

export const writeSourceColumnConfigPref = (config: SourceColumnLineConfig): void => {
  setPref(sourceColumnConfigKey, JSON.stringify(config));
};

export const buildSourceDeviceMetadataMap = (
  tree: BuildingSpaceNode[],
  unassignedDevices: BuildingDeviceNode[],
): Record<string, SourceDeviceMetadata> => {
  const out: Record<string, SourceDeviceMetadata> = {};

  const visitSpace = (space: BuildingSpaceNode, parentPath: string) => {
    const currentName = space.name || space.type || '';
    const locationPath = [parentPath, currentName].filter(Boolean).join(' ');
    for (const device of space.devices) {
      out[device.address] = {
        deviceName: device.name || '',
        manufacturer: device.manufacturer || '',
        hardware: device.hardware || '',
        locationName: space.name || '',
        locationType: space.type || '',
        locationPath,
      };
    }
    for (const child of space.spaces) visitSpace(child, locationPath);
  };

  for (const space of tree) visitSpace(space, '');
  for (const device of unassignedDevices) {
    out[device.address] = {
      deviceName: device.name || '',
      manufacturer: device.manufacturer || '',
      hardware: device.hardware || '',
      locationName: '',
      locationType: '',
      locationPath: '',
    };
  }

  return out;
};

export const resolveSourceColumnField = (
  telegram: Telegram,
  metadata: Record<string, SourceDeviceMetadata> | undefined,
  field: SourceColumnField,
): string => {
  const meta = metadata?.[telegram.source_address];
  switch (field) {
    case 'address':
      return telegram.source_address || '';
    case 'name':
      return meta?.deviceName || telegram.source_name || '';
    case 'manufacturer':
      return meta?.manufacturer || '';
    case 'hardware':
      return meta?.hardware || '';
    case 'locationName':
      return meta?.locationName || '';
    case 'locationType':
      return meta?.locationType || '';
    case 'locationPath':
      return meta?.locationPath || '';
  }
};