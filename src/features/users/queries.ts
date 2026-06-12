import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateUserInput, UpdateUserInput } from "@/types";
import { auditApi, type AuditQuery, userApi } from "@/lib/api";

export const userKeys = {
  all: ["users"] as const,
  audit: (filters: AuditQuery) => ["audit", filters] as const,
};

export function useUsersQuery(enabled = true) {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: userApi.list,
    enabled,
  });
}

export function useUserActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: userKeys.all });
  const create = useMutation({ mutationFn: userApi.create, onSuccess: refresh });
  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserInput }) =>
      userApi.update(id, payload),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: userApi.remove, onSuccess: refresh });

  return {
    addUser: (payload: CreateUserInput) => create.mutateAsync(payload),
    updateUser: (id: string, payload: UpdateUserInput) =>
      update.mutateAsync({ id, payload }),
    deleteUser: remove.mutateAsync,
  };
}

export function useAuditQuery(filters: AuditQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: userKeys.audit(filters),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => auditApi.list({ ...filters, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });
}
