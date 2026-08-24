import { useState } from 'react';
import './TeamSelector.css';

export default function TeamSelector({ teams, currentTeam, onSelectTeam, onAddTeam, onDeleteTeam, onRenameTeam }) {
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [editingTeam, setEditingTeam] = useState(null);
  const [editName, setEditName] = useState('');

  const handleAddTeam = (e) => {
    e.preventDefault();
    if (newTeamName.trim()) {
      onAddTeam(newTeamName.trim());
      setNewTeamName('');
      setShowAddTeam(false);
    }
  };

  const handleRenameTeam = (e) => {
    e.preventDefault();
    if (editName.trim() && editingTeam) {
      onRenameTeam(editingTeam.id, editName.trim());
      setEditingTeam(null);
      setEditName('');
    }
  };

  const startEditing = (team) => {
    setEditingTeam(team);
    setEditName(team.name);
  };

  return (
    <div className="team-selector">
      <div className="team-selector-header">
        <h2>Teams</h2>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowAddTeam(!showAddTeam)}
        >
          + Add Team
        </button>
      </div>

      {showAddTeam && (
        <form onSubmit={handleAddTeam} className="team-form">
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Team name"
            className="input"
            autoFocus
          />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-sm">Add</button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowAddTeam(false);
                setNewTeamName('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="team-list">
        {teams.map(team => (
          <div
            key={team.id}
            className={`team-item ${currentTeam?.id === team.id ? 'active' : ''}`}
          >
            {editingTeam?.id === team.id ? (
              <form onSubmit={handleRenameTeam} className="team-edit-form">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="input"
                  autoFocus
                />
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary btn-xs">Save</button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => {
                      setEditingTeam(null);
                      setEditName('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div
                  className="team-item-content"
                  onClick={() => onSelectTeam(team.id)}
                >
                  <span className="team-name">{team.name}</span>
                  <span className="team-players-count">
                    {team.players?.length || 0} players
                  </span>
                </div>
                <div className="team-item-actions">
                  <button
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(team);
                    }}
                    title="Rename team"
                  >
                    ✏️
                  </button>
                  {teams.length > 1 && (
                    <button
                      className="btn-icon btn-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete team "${team.name}"?`)) {
                          onDeleteTeam(team.id);
                        }
                      }}
                      title="Delete team"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
