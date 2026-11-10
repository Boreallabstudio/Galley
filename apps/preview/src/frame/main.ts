import '@videojs/html/i18n';
import './preview.css';
import { playerStyles, type WorkbenchParams } from '../shell/params';
import { applyMediaParams, initialParams, onParamsChange } from './frame';
import { createPlayer } from './player';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');
const wrapper = document.createElement('div');

wrapper.className = 'preview-player';
i18n.append(createPlayer());
wrapper.append(i18n);
document.getElementById('root')!.append(wrapper);

const credit = document.createElement('p');
credit.className = 'preview-credit';
credit.textContent = 'Film: Spring by Blender Studio, CC BY 4.0, cropped to 16:9 for this demo.';
wrapper.append(credit);

function render(params: WorkbenchParams): void {
  wrapper.removeAttribute('style');

  for (const [name, value] of Object.entries(playerStyles(params))) wrapper.style.setProperty(name, value);

  applyMediaParams(params);
}

render(initialParams());
onParamsChange(render);
