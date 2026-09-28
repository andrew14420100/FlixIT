// @ts-nocheck
/**
 * FlixIT player advertising bootstrap.
 *
 * This stays outside CustomVideoPlayer's HLS lifecycle: the content video is
 * paused while a direct browser-playable campaign video is rendered above it.
 * That means ads cannot disturb stream selection, HLS recovery, resume state or
 * Continue Watching.
 */

const NATIVE_VIDEO_SELECTOR = '[data-testid="native-video"]';
const PLAYER_SELECTOR = '[data-testid="custom-video-player"]';
const POLICY_URL = '/api/public/ads/playback-policy';
const attached = new WeakSet<HTMLVideoElement>();

function contentKey() {
  return `${window.location.pathname}${window.location.search}`;
}

function hash(value: string) {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = ((out << 5) - out + value.charCodeAt(i)) | 0;
  return Math.abs(out);
}

function policyHeaders() {
  const token = localStorage.getItem('user_token');
  return token ? { Accept: 'application/json', Authorization: `Bearer ${token}` } : { Accept: 'application/json' };
}

function campaignFor(policy: any, slot: number, key: string) {
  const campaigns = Array.isArray(policy?.campaigns) ? policy.campaigns.filter((item) => item?.video_url) : [];
  if (!campaigns.length) return null;
  const start = hash(key) % campaigns.length;
  return campaigns[(start + slot) % campaigns.length] || campaigns[0];
}

function createLabel(text: string) {
  const node = document.createElement('div');
  node.textContent = text;
  Object.assign(node.style, {
    position: 'absolute', top: '22px', right: '24px', zIndex: '4',
    padding: '7px 11px', borderRadius: '999px',
    background: 'rgba(0,0,0,.58)', border: '1px solid rgba(255,255,255,.22)',
    backdropFilter: 'blur(10px)', color: '#fff', fontFamily: 'Netflix Sans Local, Netflix Sans, Helvetica Neue, Arial, sans-serif',
    fontSize: '12px', fontWeight: '800', letterSpacing: '.055em', textTransform: 'uppercase',
  });
  return node;
}

function playAd(player: HTMLElement, contentVideo: HTMLVideoElement, campaign: any, slot: number, total: number, onDone: () => void) {
  if (!campaign?.video_url || !player?.isConnected || !contentVideo?.isConnected) {
    onDone();
    return;
  }

  const wasPlaying = !contentVideo.paused;
  try { contentVideo.pause(); } catch {}

  const overlay = document.createElement('div');
  overlay.setAttribute('data-flixit-ad-break', slot === 0 ? 'preroll' : 'midroll');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', zIndex: '80', background: '#000',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'default',
  });

  const adVideo = document.createElement('video');
  adVideo.src = campaign.video_url;
  adVideo.autoplay = true;
  adVideo.playsInline = true;
  adVideo.preload = 'auto';
  adVideo.setAttribute('disablePictureInPicture', 'true');
  Object.assign(adVideo.style, { width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block' });

  const label = createLabel(`Pubblicità ${slot + 1} di ${total}`);
  const bottom = document.createElement('div');
  Object.assign(bottom.style, {
    position: 'absolute', left: '0', right: '0', bottom: '0', zIndex: '3', padding: '70px 28px 24px',
    background: 'linear-gradient(to top, rgba(0,0,0,.86), rgba(0,0,0,0))',
    display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: '18px',
    fontFamily: 'Netflix Sans Local, Netflix Sans, Helvetica Neue, Arial, sans-serif', color: '#fff', pointerEvents: 'none',
  });
  const info = document.createElement('div');
  info.style.minWidth = '0';
  const adWord = document.createElement('div');
  adWord.textContent = 'PUBBLICITÀ';
  Object.assign(adWord.style, { color: '#e50914', fontSize: '11px', fontWeight: '900', letterSpacing: '.10em', marginBottom: '5px' });
  const name = document.createElement('div');
  name.textContent = campaign.name || 'Messaggio pubblicitario';
  Object.assign(name.style, { color: '#fff', fontSize: 'clamp(16px,1.4vw,22px)', fontWeight: '750', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  const countdown = document.createElement('div');
  countdown.textContent = 'In riproduzione';
  Object.assign(countdown.style, { color: 'rgba(255,255,255,.7)', fontSize: '13px', fontWeight: '650', flexShrink: '0' });
  info.append(adWord, name);
  bottom.append(info, countdown);

  let cta: HTMLButtonElement | null = null;
  if (campaign.click_url) {
    cta = document.createElement('button');
    cta.type = 'button';
    cta.textContent = 'Scopri di più';
    Object.assign(cta.style, {
      position: 'absolute', right: '28px', bottom: '64px', zIndex: '5', border: '1px solid rgba(255,255,255,.32)',
      borderRadius: '7px', background: 'rgba(18,28,39,.78)', color: '#fff', padding: '10px 15px',
      fontFamily: 'Netflix Sans Local, Netflix Sans, Helvetica Neue, Arial, sans-serif', fontSize: '13px', fontWeight: '750', cursor: 'pointer',
      backdropFilter: 'blur(12px)',
    });
    cta.addEventListener('click', (event) => {
      event.stopPropagation();
      window.open(campaign.click_url, '_blank', 'noopener,noreferrer');
    });
  }

  const audioButton = document.createElement('button');
  audioButton.type = 'button';
  audioButton.textContent = 'Attiva audio';
  Object.assign(audioButton.style, {
    display: 'none', position: 'absolute', left: '28px', top: '22px', zIndex: '5', border: '1px solid rgba(255,255,255,.26)',
    borderRadius: '999px', background: 'rgba(0,0,0,.55)', color: '#fff', padding: '7px 11px',
    fontFamily: 'Netflix Sans Local, Netflix Sans, Helvetica Neue, Arial, sans-serif', fontSize: '12px', fontWeight: '750', cursor: 'pointer',
  });
  audioButton.addEventListener('click', () => {
    adVideo.muted = false;
    audioButton.style.display = 'none';
  });

  overlay.append(adVideo, label, bottom, audioButton);
  if (cta) overlay.append(cta);
  player.appendChild(overlay);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { adVideo.pause(); } catch {}
    overlay.remove();
    onDone();
    // Mid-roll resumes only if the content was already playing. Pre-roll always
    // resumes because the Watch player is configured for autoplay.
    if (slot === 0 || wasPlaying) {
      contentVideo.play().catch(() => {});
    }
  };

  const updateTime = () => {
    const duration = Number(adVideo.duration || 0);
    const remaining = duration > 0 ? Math.max(0, Math.ceil(duration - Number(adVideo.currentTime || 0))) : null;
    countdown.textContent = remaining !== null ? `${remaining} s` : 'In riproduzione';
  };
  adVideo.addEventListener('loadedmetadata', updateTime);
  adVideo.addEventListener('timeupdate', updateTime);
  adVideo.addEventListener('ended', finish, { once: true });
  adVideo.addEventListener('error', finish, { once: true });

  const start = adVideo.play();
  if (start?.catch) {
    start.catch(() => {
      adVideo.muted = true;
      audioButton.style.display = 'block';
      adVideo.play().catch(finish);
    });
  }
}

async function attachAds(contentVideo: HTMLVideoElement) {
  if (attached.has(contentVideo)) return;
  attached.add(contentVideo);
  const player = contentVideo.closest(PLAYER_SELECTOR) as HTMLElement | null;
  if (!player) return;

  // Hold autoplay for the few milliseconds needed to resolve the viewer's ad
  // entitlement. This prevents a content flash before a free-viewer pre-roll.
  try { contentVideo.pause(); } catch {}

  let policy: any = null;
  try {
    const response = await fetch(POLICY_URL, { cache: 'no-store', headers: policyHeaders() });
    if (response.ok) policy = await response.json();
  } catch {}

  if (!contentVideo.isConnected || !player.isConnected) return;
  const count = Math.max(0, Math.min(2, Number(policy?.ad_count || 0)));
  const key = contentKey();
  if (!count) {
    contentVideo.play().catch(() => {});
    return;
  }

  let prerollDone = false;
  let midrollDone = false;
  const first = campaignFor(policy, 0, key);
  if (!first) {
    contentVideo.play().catch(() => {});
    return;
  }

  playAd(player, contentVideo, first, 0, count, () => { prerollDone = true; });

  if (count < 2) return;
  const onTimeUpdate = () => {
    if (!prerollDone || midrollDone || player.querySelector('[data-flixit-ad-break]')) return;
    const duration = Number(contentVideo.duration || 0);
    if (!(duration > 0)) return;
    // Trigger once around the middle; if the user resumes/seeks beyond halfway,
    // the second free-tier break is shown on the next timeupdate.
    if (Number(contentVideo.currentTime || 0) < duration * 0.5) return;
    midrollDone = true;
    const second = campaignFor(policy, 1, key) || first;
    playAd(player, contentVideo, second, 1, 2, () => {});
  };
  contentVideo.addEventListener('timeupdate', onTimeUpdate);
}

function scan() {
  if (!/\/watch(?:\/|$)/.test(window.location.pathname)) return;
  document.querySelectorAll<HTMLVideoElement>(NATIVE_VIDEO_SELECTOR).forEach((video) => attachAds(video));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const observer = new MutationObserver(scan);
  const start = () => {
    scan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  // Block player keyboard shortcuts while an ad is on screen.
  window.addEventListener('keydown', (event) => {
    if (!document.querySelector('[data-flixit-ad-break]')) return;
    if ([' ', 'k', 'K', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

export {};
