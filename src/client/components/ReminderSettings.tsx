import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Bell } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/hooks';
import { Button, ErrorState, FormField } from './ui';

type Field = 'risk_days' | 'lifecycle_days' | 'license_days';

export function ReminderSettings({ customerId, field, label }: { customerId?: string; field: Field; label: string }) {
  const me = useMe();
  const client = useQueryClient();
  const customers = me.data?.customers ?? [];
  const target = customerId ?? (customers.length === 1 ? customers[0].id : undefined);
  const query = useQuery({ queryKey: ['reminders', target], queryFn: () => api.get(`/api/settings/reminders/${target}`), enabled: !!target });
  const [text, setText] = useState('');
  useEffect(() => {
    if (query.data) setText(query.data[field].join(', '));
  }, [query.data, field]);
  const save = useMutation({
    mutationFn: () => api.put(`/api/settings/reminders/${target}`, { [field]: text.split(',').map((x) => Number(x.trim())) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['reminders', target] }),
  });
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button><Bell size={12} aria-hidden /> Reminders</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-72 rounded border border-line bg-surface-2 p-2.5 text-xs shadow-lg">
          {!target ? (
            <p>Select one customer in the top bar to change its reminder settings.</p>
          ) : (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <p className="text-muted">Applies to {customers.find((c: any) => c.id === target)?.name}. In-app notifications go out when each threshold is reached.</p>
              <FormField label={label} hint="Whole days before the date, separated by commas">
                <input value={text} onChange={(e) => setText(e.target.value)} />
              </FormField>
              {save.isError && <ErrorState error={save.error} />}
              {save.isSuccess && <p role="status" className="text-ok">Saved.</p>}
              <Button type="submit" variant="primary" disabled={save.isPending}>Save</Button>
            </form>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
