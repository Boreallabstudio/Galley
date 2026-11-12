import '@videojs/html/i18n';
import './site.css';
import { createPlayer } from '../frame/player';

// The showcase page: one player, as wide as the page allows, with the skin's own 16:9 frame.
const i18n = document.createElement('media-i18n');
i18n.append(createPlayer());
document.getElementById('player')!.append(i18n);
