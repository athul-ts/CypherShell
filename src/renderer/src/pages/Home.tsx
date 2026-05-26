import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Server, Play, MoreVertical, Copy, Trash } from 'lucide-react';
import { useState, useMemo } from 'react';
import { ProfileForm } from '../components/profiles/ProfileForm';
import { useTabStore } from '../store/tabStore';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export default function Home() {
  const { data: profiles, isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const res = await api.get('/profiles');
      return res.data;
    },
  });

  const [formOpen, setFormOpen] = useState(false);
  const addTab = useTabStore(s => s.addTab);
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProfiles = useMemo(() => {
    if (!profiles) return [];
    const lowerQ = searchQuery.toLowerCase();
    return profiles.filter((p: any) => 
      p.name.toLowerCase().includes(lowerQ) || 
      p.host.toLowerCase().includes(lowerQ) || 
      (p.group && p.group.toLowerCase().includes(lowerQ))
    );
  }, [profiles, searchQuery]);

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/profiles/${id}/duplicate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/profiles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  });

  const handleOpenProfile = (profile: any) => {
    addTab({
      id: `profile-${profile.id}`,
      type: 'profile-detail',
      title: profile.name,
      profileId: profile.id,
    });
  };

  return (
    <div className="flex-1 p-8 bg-[#0a0a0f] h-full overflow-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-200">Connection Profiles</h1>
          <p className="text-slate-500 mt-1">Manage and connect to your saved SSH hosts.</p>
        </div>
        <div className="flex items-center gap-4">
          <input 
            type="text" 
            placeholder="Search profiles..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-[#1a1c23] border border-slate-800 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors w-64"
          />
          <button 
            onClick={() => setFormOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            New Profile
          </button>
        </div>
      </div>

      <ProfileForm open={formOpen} onOpenChange={setFormOpen} />

      {isLoading ? (
        <div className="text-slate-500">Loading profiles...</div>
      ) : filteredProfiles.length === 0 ? (
        <div className="text-center py-20 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
          <Server className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300">No profiles found</h3>
          <p className="text-slate-500 mt-1">{profiles?.length === 0 ? "Create your first connection profile to get started." : "Try adjusting your search filter."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProfiles.map((profile: any) => (
            <div key={profile.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-emerald-500/50 transition-colors group relative">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Server className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-200">{profile.name}</h3>
                      {profile.group && (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                          {profile.group}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{profile.username}@{profile.host}</p>
                  </div>
                </div>
                
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="w-5 h-5" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="end" className="bg-[#1a1c23] border border-slate-800 rounded-lg p-1 min-w-[160px] shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100">
                      <DropdownMenu.Item 
                        onClick={() => duplicateMutation.mutate(profile.id)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-md cursor-default outline-none select-none"
                      >
                        <Copy className="w-4 h-4" />
                        Duplicate
                      </DropdownMenu.Item>
                      <DropdownMenu.Item 
                        onClick={() => deleteMutation.mutate(profile.id)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md cursor-default outline-none select-none"
                      >
                        <Trash className="w-4 h-4" />
                        Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              
              <div className="flex items-center gap-2 mt-4">
                <button 
                  onClick={() => handleOpenProfile(profile)}
                  className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 py-2 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Manage Profile
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
