import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Camera, CameraInput } from "@/types";
import { cameraApi, statsApi } from "@/lib/api";

export const cameraKeys = {
  all: ["cameras"] as const,
  stats: ["camera-stats"] as const,
  hardwareInfo: (id: string) => ["camera-hardware-info", id] as const,
};

function sortCameras(cameras: Camera[]) {
  return [...cameras].sort(
    (a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name),
  );
}

export function useCamerasQuery(enabled = true) {
  return useQuery({
    queryKey: cameraKeys.all,
    queryFn: cameraApi.list,
    enabled,
    select: sortCameras,
  });
}

export function useCameraHardwareInfoQuery(id: string, enabled = false) {
  return useQuery({
    queryKey: cameraKeys.hardwareInfo(id),
    queryFn: () => cameraApi.hardwareInfo(id),
    enabled,
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
    retry: false, // do not retry onvif connection failures heavily
  });
}

export function useCameraStats(enabled: boolean, autoRefresh: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: cameraKeys.stats,
    queryFn: statsApi.get,
    enabled,
    refetchInterval: autoRefresh ? 1000 : false,
  });

  useEffect(() => {
    if (query.data?.cameras) {
      queryClient.setQueryData(cameraKeys.all, sortCameras(query.data.cameras));
    }
  }, [query.data, queryClient]);

  return query;
}

export function useCameraActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: cameraKeys.all });

  const create = useMutation({
    mutationFn: (payload: CameraInput) => cameraApi.create(payload),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CameraInput> }) =>
      cameraApi.update(id, payload),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: cameraApi.remove,
    onSuccess: refresh,
  });
  const restart = useMutation({
    mutationFn: ({ id, output }: { id: string; output?: Camera["streamType"] }) =>
      cameraApi.restart(id, output),
    onSuccess: refresh,
  });
  const probe = useMutation({
    mutationFn: ({ id, deep }: { id: string; deep?: boolean }) =>
      cameraApi.probe(id, deep),
    onSuccess: ({ camera }) => {
      queryClient.setQueryData<Camera[]>(cameraKeys.all, (current = []) =>
        sortCameras(current.map((item) => item.id === camera.id ? camera : item)),
      );
    },
  });
  const probeAll = useMutation({
    mutationFn: (deep?: boolean) => cameraApi.probeAll(deep),
    onSuccess: (results) => {
      const updates = new Map(results.filter(Boolean).map((item) => [item.camera.id, item.camera]));
      queryClient.setQueryData<Camera[]>(cameraKeys.all, (current = []) =>
        sortCameras(current.map((item) => updates.get(item.id) || item)),
      );
    },
  });

  return {
    addCamera: create.mutateAsync,
    updateCamera: (id: string, payload: Partial<CameraInput>) =>
      update.mutateAsync({ id, payload }),
    deleteCamera: remove.mutateAsync,
    restartCamera: (id: string, output?: Camera["streamType"]) =>
      restart.mutateAsync({ id, output }),
    probeCamera: (id: string, deep = false) => probe.mutateAsync({ id, deep }),
    probeAll: (deep = false) => probeAll.mutateAsync(deep),
  };
}
