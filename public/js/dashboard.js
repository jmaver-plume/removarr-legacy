class MediaDashboard {
    constructor() {
        this.mediaData = [];
        this.voters = [];
        this.currentTab = 'movie';
        this.config = null;
        this.init();
    }

    async init() {
        this.setupSettings();
        await this.loadConfig();
        await this.loadVoters();
        this.loadMedia();
        this.setupEventListeners();
        // Refresh data every 30 seconds
        setInterval(() => this.loadMedia(), 30000);
    }

    setupSettings() {
        const form = document.getElementById('settings-form');
        const status = document.getElementById('settings-status');
        document.getElementById('settings-nav').addEventListener('click', async () => {
            document.getElementById('library-view').hidden = true;
            document.getElementById('settings-view').hidden = false;
            document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.id === 'settings-nav'));
            try {
                const response = await fetch('/removarr/api/settings');
                if (!response.ok || response.redirected) throw new Error('Unable to load settings');
                const settings = await response.json();
                for (const key of ['sonarr_url', 'radarr_url']) form.elements[key].value = settings[key];
                form.elements.voters.value = settings.voters.join('\n');
            } catch (error) { status.textContent = error.message; }
        });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const button = form.querySelector('button');
            button.disabled = true;
            status.textContent = 'Saving…';
            const updates = Object.fromEntries(new FormData(form));
            updates.voters = updates.voters.split(/[,\n]/).map(v => v.trim()).filter(Boolean);
            for (const key of ['sonarr_api_key', 'radarr_api_key']) if (!updates[key]) delete updates[key];
            try {
                const response = await fetch('/removarr/api/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(updates)});
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Unable to save settings');
                form.elements.sonarr_api_key.value = '';
                form.elements.radarr_api_key.value = '';
                await this.loadVoters();
                await this.loadConfig();
                this.renderMedia();
                status.textContent = 'Settings saved.';
            } catch (error) { status.textContent = error.message; }
            finally { button.disabled = false; }
        });
    }

    async loadConfig() {
        const response = await fetch('/removarr/api/config');
        if (!response.ok) throw new Error('Failed to fetch config');

        this.config = await response.json();
    }

    async loadVoters() {
        const response = await fetch('/removarr/api/voters');
        if (!response.ok) throw new Error('Failed to fetch voters');
        
        const data = await response.json();
        this.voters = data.voters;
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-media-btn')) {
                this.handleDeleteMedia(e.target);
            }
            if (e.target.id === 'resync-btn') {
                this.handleResync();
            }
            if (e.target.classList.contains('tab-button') && e.target.dataset.type) {
                this.handleTabChange(e.target);
            }
        });

        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('delete-checkbox')) {
                this.handleVoteChange(e.target);
            }
        });
    }

    handleTabChange(button) {
        document.getElementById("library-view").hidden = false;
        document.getElementById("settings-view").hidden = true;
        // Update active tab
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        this.currentTab = button.dataset.type;
        this.renderMedia();
    }

    async handleVoteChange(checkbox) {
        const mediaCard = checkbox.closest('.media-card');
        const mediaId = mediaCard.dataset.id;
        const voterName = checkbox.dataset.voter;
        const vote = checkbox.checked ? 'no' : 'yes'; // checked = delete (no), unchecked = keep (yes)

        try {
            const response = await fetch('/removarr/api/vote/individual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    mediaId: parseInt(mediaId), 
                    voterName: voterName, 
                    vote: vote 
                })
            });

            if (!response.ok) throw new Error('Failed to submit vote');

            const result = await response.json();
            
            // Update the delete button state
            this.updateDeleteButton(mediaCard, result.readyForDeletion);

        } catch (error) {
            console.error('Error submitting vote:', error);
            this.showError('Failed to submit vote');
            // Revert checkbox state
            checkbox.checked = !checkbox.checked;
        }
    }

    updateDeleteButton(mediaCard, readyForDeletion) {
        const deleteBtn = mediaCard.querySelector('.delete-media-btn');
        if (deleteBtn) {
            deleteBtn.disabled = !readyForDeletion;
            deleteBtn.textContent = readyForDeletion ? 'Delete Media' : 'Waiting for all votes';
            
            // Update CSS classes for proper styling
            if (readyForDeletion) {
                deleteBtn.classList.remove('btn-secondary');
                deleteBtn.classList.add('btn-danger', 'ready');
            } else {
                deleteBtn.classList.remove('btn-danger', 'ready');
                deleteBtn.classList.add('btn-secondary');
            }
        }
    }

    async handleDeleteMedia(button) {
        const mediaCard = button.closest('.media-card');
        const mediaId = mediaCard.dataset.id;
        const mediaTitle = mediaCard.querySelector('.media-title-year').textContent;
        
        button.disabled = true;
        button.textContent = 'Deleting...';

        try {
            const response = await fetch(`/removarr/api/delete/${mediaId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) throw new Error('Failed to delete media');

            this.showNotification(`Successfully deleted "${mediaTitle}"`, 'success');
            
            // Reload media to remove the deleted item
            await this.loadMedia();

        } catch (error) {
            console.error('Error deleting media:', error);
            this.showError('Failed to delete media');
            button.disabled = false;
            button.textContent = 'Delete Media';
        }
    }

    async handleResync() {
        const resyncBtn = document.getElementById('resync-btn');
        const originalText = resyncBtn.textContent;
        
        resyncBtn.disabled = true;
        resyncBtn.textContent = '🔄 Syncing...';
        
        try {
            const response = await fetch('/removarr/api/resync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (!response.ok) throw new Error('Failed to resync');
            
            const result = await response.json();
            const totals = result.results.totals;
            
            let message = 'Resync completed! ';
            const details = [];
            
            if (totals.added > 0) details.push(`${totals.added} added`);
            if (totals.updated > 0) details.push(`${totals.updated} updated`);
            if (totals.deleted > 0) details.push(`${totals.deleted} deleted`);
            if (totals.errors > 0) details.push(`${totals.errors} errors`);
            
            message += details.length > 0 ? details.join(', ') : 'No changes';
            
            this.showNotification(message, totals.errors > 0 ? 'warning' : 'success');
            
            // Reload media to show changes
            await this.loadMedia();
            
        } catch (error) {
            console.error('Error during resync:', error);
            this.showError('Failed to resync from Sonarr/Radarr');
        } finally {
            resyncBtn.disabled = false;
            resyncBtn.textContent = originalText;
        }
    }

    async loadMedia() {
        const response = await fetch('/removarr/api/media');
        if (!response.ok) throw new Error('Failed to fetch media');
        
        this.mediaData = await response.json();
        this.updateTabCounts();
        this.renderMedia();
    }

    updateTabCounts() {
        const movieCount = this.mediaData.filter(media => media.type === 'movie').length;
        const seriesCount = this.mediaData.filter(media => media.type === 'series').length;
        
        const movieTab = document.querySelector('.tab-button[data-type="movie"]');
        const seriesTab = document.querySelector('.tab-button[data-type="series"]');
        
        if (movieTab) {
            movieTab.textContent = `Movies (${movieCount})`;
        }
        if (seriesTab) {
            seriesTab.textContent = `TV Shows (${seriesCount})`;
        }
    }

    renderMedia() {
        const grid = document.getElementById('media-grid');
        
        // Filter media by current tab
        const filteredMedia = this.mediaData.filter(media => media.type === this.currentTab);
        
        if (filteredMedia.length === 0) {
            grid.innerHTML = `<div class="loading">No pending ${this.currentTab === 'movie' ? 'movies' : 'TV shows'}</div>`;
            return;
        }

        grid.innerHTML = filteredMedia.map(media => this.createMediaCard(media)).join('');
    }

    createMediaCard(media) {
        const posterUrl = media.poster_url;
        const votes = media.votes || {};
        
        // Check if all voters have voted to delete
        const allVotedDelete = this.voters.every(voter => votes[voter] === 'no');
        
        // Determine download status color
        const downloadedStatus = media.downloaded ? 'downloaded' : 'not-downloaded';
        
        // Generate the appropriate link based on media type using same host as current site
        const currentHost = window.location.origin;
        const serviceUrl = media.type === 'movie' 
            ? `${currentHost}/radarr/movie/${media.title_slug}`
            : `${currentHost}/sonarr/series/${media.title_slug}`;
        
        return `
            <div class="media-card" data-id="${media.id}">
                <div class="media-poster-container">
                    <img src="${posterUrl}" alt="${media.title}" class="media-poster" 
                         onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4K';">
                    <div class="download-status ${downloadedStatus}"></div>
                </div>
                <div class="media-info">
                    <div class="media-header">
                        <div class="media-title-year">${media.title}</div>
                        <a href="${serviceUrl}" target="_blank" class="service-link">
                            ${media.type === 'movie' ? 'Radarr' : 'Sonarr'} →
                        </a>
                    </div>
                    ${media.overview ? `<div class="media-overview">${media.overview}</div>` : ''}
                    
                    <div class="vote-section">
                        <div class="voters-list">
                            ${this.voters.map(voter => `
                                <label class="voter-checkbox-label">
                                    <input type="checkbox" 
                                           class="delete-checkbox" 
                                           data-voter="${voter}"
                                           ${votes[voter] === 'no' ? 'checked' : ''}>
                                    <span class="voter-name">${voter}</span>
                                </label>
                            `).join('')}
                        </div>
                        
                        <button class="delete-media-btn btn ${allVotedDelete ? 'btn-danger ready' : 'btn-secondary'}" 
                                data-media-id="${media.id}"
                                ${!allVotedDelete ? 'disabled' : ''}>
                            ${allVotedDelete ? 'Delete Media' : 'Waiting for all votes'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        if (type === 'success') {
            notification.style.backgroundColor = '#28a745';
        } else if (type === 'error') {
            notification.style.backgroundColor = '#dc3545';
        } else if (type === 'warning') {
            notification.style.backgroundColor = '#ffc107';
            notification.style.color = '#212529';
        } else {
            notification.style.backgroundColor = '#007bff';
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    showError(message) {
        this.showNotification(message, 'error');
    }
}

// Add slide-in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MediaDashboard();
});