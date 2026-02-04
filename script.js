// Mídias específicas para cada tela
const screenMedia = {
    2: 'assets/WhatsApp Image 2026-02-04 at 12.44.27.jpeg',
    3: 'assets/WhatsApp Video 2026-02-04 at 12.44.29.mp4',
    4: 'assets/WhatsApp Image 2026-02-04 at 12.44.28.jpeg',
    5: 'assets/WhatsApp Image 2026-02-04 at 12.44.28 (1).jpeg',
    6: 'assets/WhatsApp Video 2026-02-04 at 12.44.31.mp4',
    7: 'assets/WhatsApp Image 2026-02-04 at 12.44.30.jpeg',
    8: 'assets/WhatsApp Image 2026-02-04 at 12.44.30 (1).jpeg',
    9: 'assets/WhatsApp Video 2026-02-04 at 12.44.35.mp4',
    10: 'assets/WhatsApp Image 2026-02-04 at 12.44.32.jpeg'
};

// Trocar background
function changeBackground(media) {
    const videoEl = document.querySelector('video.background-media');
    const imgEl = document.querySelector('img.background-media');
    
    if (!media) return;
    
    if (media.includes('.mp4')) {
        imgEl.classList.remove('active');
        videoEl.src = media;
        videoEl.classList.add('active');
        videoEl.play().catch(e => console.log('Video play error:', e));
    } else {
        videoEl.classList.remove('active');
        imgEl.src = media;
        imgEl.classList.add('active');
    }
}

// Iniciar com primeira mídia
changeBackground(screenMedia[2]);

// Criar corações flutuantes (menos em mobile para performance)
function createHeart() {
    const heart = document.createElement('div');
    heart.className = 'heart';
    heart.style.left = Math.random() * 100 + '%';
    heart.style.animationDuration = (Math.random() * 3 + 3) + 's';
    const size = Math.random() * 30 + 20;
    heart.style.width = heart.style.height = size + 'px';
    
    const before = document.createElement('style');
    before.textContent = `
        .heart:before { width: ${size}px; height: ${size}px; left: -${size/2}px; }
        .heart:after { width: ${size}px; height: ${size}px; top: -${size/2}px; }
    `;
    heart.appendChild(before);
    
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 6000);
}

// Criar sparkles (menos em mobile para performance)
function createSparkle() {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.left = Math.random() * 100 + '%';
    sparkle.style.top = Math.random() * 100 + '%';
    document.body.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 2000);
}

// Criar efeitos periodicamente (ajustado para mobile)
const isMobile = window.innerWidth < 768;
const heartInterval = isMobile ? 500 : 300;
const sparkleInterval = isMobile ? 400 : 200;

setInterval(createHeart, heartInterval);
setInterval(createSparkle, sparkleInterval);

// Navegação entre telas
function nextScreen(screenNumber) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById('screen' + screenNumber);
    if (screen) {
        screen.classList.add('active');
    }

    // Trocar mídia de fundo
    if (screenMedia[screenNumber]) {
        changeBackground(screenMedia[screenNumber]);
    }

    // Contador especial para tela 8
    if (screenNumber === 8) {
        let count = 3;
        const countdownEl = document.getElementById('countdown');
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                countdownEl.textContent = count;
            } else {
                clearInterval(interval);
                setTimeout(() => nextScreen(9), 500);
            }
        }, 1000);
    }
}

// Mostrar página da história
function showStory() {
    // Esconder todas as telas e container
    document.querySelector('.container').style.display = 'none';
    document.querySelector('.overlay').style.display = 'none';
    document.querySelector('video.background-media').style.display = 'none';
    document.querySelector('img.background-media').style.display = 'none';
    
    // Mostrar página da história
    document.getElementById('storyPage').classList.add('active');
    document.body.style.overflow = 'auto';
    
    // Scroll suave para o topo
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Botão "não" que foge
function moveButton(btn) {
    // Margens de segurança maiores para mobile
    const marginX = window.innerWidth < 768 ? 20 : 100;
    const marginY = window.innerHeight < 768 ? 20 : 100;
    
    const maxX = window.innerWidth - btn.offsetWidth - marginX;
    const maxY = window.innerHeight - btn.offsetHeight - marginY;
    
    const randomX = Math.max(marginX, Math.random() * maxX);
    const randomY = Math.max(marginY, Math.random() * maxY);
    
    btn.style.position = 'fixed';
    btn.style.left = randomX + 'px';
    btn.style.top = randomY + 'px';
    btn.style.transition = 'all 0.3s ease';

    const messages = [
        'Não mesmo? 🥺',
        'Tem certeza? 😢',
        'Tenta de novo! 😅',
        'Olha o SIM ali ó 👉',
        'Clica no SIM! ❤️',
        'Eu te amo! 💕',
        'Por favor? 🥺',
        'Só clica no SIM! 😊'
    ];
    btn.textContent = messages[Math.floor(Math.random() * messages.length)];
}

// Adicionar suporte a touch para mobile
document.addEventListener('DOMContentLoaded', function() {
    const noBtns = document.querySelectorAll('.btn-no');
    noBtns.forEach(btn => {
        btn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            moveButton(this);
        });
    });
});

// Celebração final
function celebration() {
    // Explodir corações
    for (let i = 0; i < 150; i++) {
        setTimeout(createHeart, i * 30);
    }
    
    // Explodir sparkles
    for (let i = 0; i < 80; i++) {
        setTimeout(createSparkle, i * 25);
    }

    // Mudar cores
    const colors = ['#ff69b4', '#ff1493', '#ff6b9d', '#ffc0cb', '#c44569'];
    let colorIndex = 0;
    const colorInterval = setInterval(() => {
        document.body.style.background = colors[colorIndex];
        colorIndex = (colorIndex + 1) % colors.length;
    }, 300);

    setTimeout(() => {
        clearInterval(colorInterval);
        document.body.style.background = 'linear-gradient(135deg, #1a1a2e, #16213e)';
        alert('💖 EU TE AMO MUITO, ADRIELLE! Obrigado por estar comigo e me fazer o homem mais feliz do mundo! 🐧❤️');
    }, 6000);
}

// Iniciar após loading
setTimeout(() => {
    nextScreen(2);
}, 3000);

// Impedir F12
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
        e.preventDefault();
    }
});
