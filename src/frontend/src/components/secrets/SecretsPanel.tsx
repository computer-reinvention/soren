import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Secrets panel — write-only. Users can set and delete secrets but never
 * view stored values. Once saved, a secret's value is gone forever from the UI.
 * This matches the Vercel/Netlify UX intentionally.
 */
const LS_KEY = 'soren-secrets-passphrase';

export function SecretsPanel() {
  const stored = localStorage.getItem(LS_KEY) ?? '';
  const [passphraseInput, setPassphraseInput] = useState(stored);
  const [passphrase, setPassphrase] = useState(stored);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(stored.length > 0);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const queryClient = useQueryClient();

  const {
    data: secretsData,
    error: listError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['secrets', passphrase],
    queryFn: () => api.listSecrets(passphrase),
    enabled: isUnlocked && passphrase.length > 0,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // If listing fails (wrong passphrase), go back to locked state
  useEffect(() => {
    if (listError) {
      setUnlockError('Wrong passphrase');
      setIsUnlocked(false);
      setPassphrase('');
      localStorage.removeItem(LS_KEY);
    }
  }, [listError]);

  const handleUnlock = () => {
    if (!passphraseInput) return;
    setUnlockError('');
    setPassphrase(passphraseInput);
    setIsUnlocked(true);
    localStorage.setItem(LS_KEY, passphraseInput);
  };

  const handleLock = () => {
    setPassphrase('');
    setPassphraseInput('');
    setIsUnlocked(false);
    setUnlockError('');
    localStorage.removeItem(LS_KEY);
    queryClient.removeQueries({ queryKey: ['secrets'] });
  };

  const setMutation = useMutation({
    mutationFn: () => api.setSecret(newName.trim(), newValue, passphrase),
    onSuccess: () => {
      setNewName('');
      setNewValue('');
      refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.deleteSecret(name, passphrase),
    onSuccess: () => refetch(),
  });

  const secretNames: string[] = secretsData?.secrets ?? [];

  if (!isUnlocked) {
    return (
      <div className="px-2 py-2 space-y-2">
        {!passphraseInput && !unlockError && (
          <p className="text-[11px] text-muted-foreground px-1">Set a passphrase to manage secrets</p>
        )}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Input
              type={showPassphrase ? 'text' : 'password'}
              placeholder="Passphrase to unlock"
              value={passphraseInput}
              onChange={(e) => {
                setPassphraseInput(e.target.value);
                setUnlockError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              className="h-7 text-xs pr-7"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPassphrase
                ? <EyeOff className="h-3.5 w-3.5" />
                : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleUnlock}
            disabled={!passphraseInput}
          >
            <Unlock className="h-3 w-3 mr-1" />
            Unlock
          </Button>
        </div>
        {unlockError && (
          <p className="text-xs text-destructive px-1">{unlockError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 py-2 space-y-2">
      {/* Lock button */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-mono">
          {isFetching ? 'loading…' : `${secretNames.length} secret${secretNames.length !== 1 ? 's' : ''}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={handleLock}
        >
          <Lock className="h-3 w-3 mr-1" />
          Lock
        </Button>
      </div>

      {/* Secret names list — names only, no values */}
      {secretNames.length > 0 && (
        <ul className="space-y-0.5">
          {secretNames.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/50 group"
            >
              <span className="flex-1 text-xs font-mono truncate">{name}</span>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-5 w-5 opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity',
                  'text-destructive hover:text-destructive hover:bg-destructive/10'
                )}
                onClick={() => deleteMutation.mutate(name)}
                disabled={deleteMutation.isPending}
                title={`Delete ${name}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Add new secret — value input is password type, never echoed */}
      <div className="space-y-1 pt-1 border-t border-border/50">
        <Input
          type="text"
          placeholder="SECRET_NAME"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-7 text-xs font-mono"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="flex gap-1.5">
          <Input
            type="password"
            placeholder="value (never shown again)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim() && newValue) {
                setMutation.mutate();
              }
            }}
            className="h-7 text-xs flex-1"
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            onClick={() => setMutation.mutate()}
            disabled={!newName.trim() || !newValue || setMutation.isPending}
          >
            <Plus className="h-3 w-3 mr-1" />
            Set
          </Button>
        </div>
        {setMutation.isError && (
          <p className="text-xs text-destructive">{setMutation.error?.message}</p>
        )}
        {deleteMutation.isError && (
          <p className="text-xs text-destructive">{deleteMutation.error?.message}</p>
        )}
      </div>
    </div>
  );
}
