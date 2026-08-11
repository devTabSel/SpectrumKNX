export interface BuildingDeviceNode {
  address: string;
  name?: string;
  channels?: Array<{ kos?: Array<{ group_addresses?: Array<{ address: string }> }> }>;
  kos?: Array<{ group_addresses?: Array<{ address: string }> }>;
}

export interface BuildingSpaceNode {
  type?: string;
  name?: string;
  spaces?: BuildingSpaceNode[];
  devices?: BuildingDeviceNode[];
}

const collectDeviceGaAddresses = (device: BuildingDeviceNode): string[] => {
  const addresses = new Set<string>();
  for (const ko of device.channels?.flatMap(ch => ch.kos ?? []) ?? []) {
    for (const ga of ko.group_addresses ?? []) {
      if (ga.address) addresses.add(ga.address);
    }
  }
  for (const ko of device.kos ?? []) {
    for (const ga of ko.group_addresses ?? []) {
      if (ga.address) addresses.add(ga.address);
    }
  }
  return [...addresses];
};

export const buildDeviceGaMap = (
  tree: BuildingSpaceNode[] = [],
  unassignedDevices: BuildingDeviceNode[] = [],
): Record<string, string[]> => {
  const out: Record<string, string[]> = {};

  const visitSpace = (space: BuildingSpaceNode) => {
    for (const device of space.devices ?? []) {
      const addresses = collectDeviceGaAddresses(device);
      if (addresses.length > 0) out[device.address] = addresses;
    }
    for (const child of space.spaces ?? []) visitSpace(child);
  };

  for (const space of tree) visitSpace(space);
  for (const device of unassignedDevices) {
    const addresses = collectDeviceGaAddresses(device);
    if (addresses.length > 0) out[device.address] = addresses;
  }

  return out;
};

export const expandVisualizationTargets = (
  flaggedAddresses: string[],
  deviceGaMap: Record<string, string[]>,
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const address of flaggedAddresses) {
    if (!address) continue;
    const related = deviceGaMap[address] ?? [address];
    for (const target of related) {
      if (seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
  }

  return out;
};
