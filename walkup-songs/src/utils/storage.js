// Local Storage utility functions

const STORAGE_KEY = 'walkup-songs-data';

export const saveData = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Error saving data:', error);
    return false;
  }
};

export const loadData = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : getDefaultData();
  } catch (error) {
    console.error('Error loading data:', error);
    return getDefaultData();
  }
};

export const getDefaultData = () => ({
  teams: [
    {
      id: Date.now(),
      name: 'My Team',
      players: []
    }
  ],
  currentTeamId: null
});

export const exportData = (data) => {
  const dataStr = JSON.stringify(data, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `walkup-songs-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

export const importData = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};
