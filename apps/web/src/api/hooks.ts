import type { BrandingDto, MeResponse } from '@perspice/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CustomerDto, GroupDto, RoleDto, UserDto } from './types';

export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api<RoleDto[]>('/roles') });

export const useCustomers = (enabled = true) =>
  useQuery({ queryKey: ['customers'], queryFn: () => api<CustomerDto[]>('/customers'), enabled });

export const useCustomer = (id: string) =>
  useQuery({ queryKey: ['customers', id], queryFn: () => api<CustomerDto>(`/customers/${id}`) });

export const useGroups = (customerId: string | null | undefined) =>
  useQuery({
    queryKey: ['customers', customerId, 'groups'],
    queryFn: () => api<GroupDto[]>(`/customers/${customerId}/groups`),
    enabled: !!customerId,
  });

export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<UserDto[]>('/users') });

/** Invalidate the given query key prefixes after a successful mutation. */
export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: unknown[][] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

export const useUpdateMe = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; name: string }) => api<UserDto>(`/users/${vars.id}`, { method: 'PATCH', body: { name: vars.name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

export const fetchMe = () => api<MeResponse>('/auth/me');
export const refreshBranding = (qc: ReturnType<typeof useQueryClient>, branding?: BrandingDto) =>
  branding ? qc.setQueryData(['public', 'branding'], branding) : qc.invalidateQueries({ queryKey: ['public', 'branding'] });
