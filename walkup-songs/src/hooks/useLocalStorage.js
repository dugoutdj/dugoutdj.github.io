import { useState, useEffect } from 'react';
import { saveData, loadData } from '../utils/storage';

export const useLocalStorage = () => {
  const [data, setData] = useState(loadData());

  useEffect(() => {
    saveData(data);
  }, [data]);

  const addTeam = (name) => {
    const newTeam = {
      id: Date.now(),
      name,
      players: []
    };
    setData(prev => ({
      ...prev,
      teams: [...prev.teams, newTeam],
      currentTeamId: prev.currentTeamId || newTeam.id
    }));
  };

  const updateTeam = (teamId, updates) => {
    setData(prev => ({
      ...prev,
      teams: prev.teams.map(team =>
        team.id === teamId ? { ...team, ...updates } : team
      )
    }));
  };

  const deleteTeam = (teamId) => {
    setData(prev => {
      const newTeams = prev.teams.filter(t => t.id !== teamId);
      return {
        teams: newTeams,
        currentTeamId: prev.currentTeamId === teamId
          ? (newTeams[0]?.id || null)
          : prev.currentTeamId
      };
    });
  };

  const setCurrentTeam = (teamId) => {
    setData(prev => ({ ...prev, currentTeamId: teamId }));
  };

  const addPlayer = (teamId, player) => {
    const newPlayer = {
      id: Date.now(),
      name: player.name,
      pronounced: player.pronounced || player.name || '',
      number: player.number || '',
      songUrl: player.songUrl || '',
      songSource: player.songSource || '',
      songVideoId: player.songVideoId || '',
      songTitle: player.songTitle || '',
      songThumbnail: player.songThumbnail || '',
      appleTrackId: player.appleTrackId || '',
      previewUrl: player.previewUrl || '',
      artworkUrl: player.artworkUrl || '',
      startTime: player.startTime || 0,
      duration: player.duration || 30,
      updatedAt: player.updatedAt || Date.now(),
      coachEditedAt: player.coachEditedAt || 0,
      order: player.order || 0
    };

    setData(prev => ({
      ...prev,
      teams: prev.teams.map(team =>
        team.id === teamId
          ? { ...team, players: [...team.players, newPlayer] }
          : team
      )
    }));
  };

  const updatePlayer = (teamId, playerId, updates) => {
    setData(prev => ({
      ...prev,
      teams: prev.teams.map(team =>
        team.id === teamId
          ? {
              ...team,
              players: team.players.map(player =>
                player.id === playerId ? { ...player, ...updates } : player
              )
            }
          : team
      )
    }));
  };

  const deletePlayer = (teamId, playerId) => {
    setData(prev => ({
      ...prev,
      teams: prev.teams.map(team =>
        team.id === teamId
          ? {
              ...team,
              players: team.players.filter(p => p.id !== playerId)
            }
          : team
      )
    }));
  };

  const reorderPlayers = (teamId, players) => {
    setData(prev => ({
      ...prev,
      teams: prev.teams.map(team =>
        team.id === teamId
          ? { ...team, players }
          : team
      )
    }));
  };

  const importTeamData = (importedData) => {
    setData(importedData);
  };

  const getCurrentTeam = () => {
    return data.teams.find(t => t.id === data.currentTeamId) || data.teams[0] || null;
  };

  return {
    data,
    teams: data.teams,
    currentTeam: getCurrentTeam(),
    addTeam,
    updateTeam,
    deleteTeam,
    setCurrentTeam,
    addPlayer,
    updatePlayer,
    deletePlayer,
    reorderPlayers,
    importTeamData
  };
};
