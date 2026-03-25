const symbols = ['🍒', '🍋', '🔔', '⭐', '7️⃣'];

const els = {
  credits: document.getElementById('credits'),
  highscore: document.getElementById('highscore'),
  streak: document.getElementById('streak'),
  bet: document.getElementById('bet'),
  spinBtn: document.getElementById('spinBtn'),
  resetBtn: document.getElementById('resetBtn'),
  message: document.getElementById('message'),
  reels: [
    document.getElementById('reel1'),
    document.getElementById('reel2'),
    document.getElementById('reel3')
  ]
};

let state = {
  credits: 100,
  highscore: 100,
  streak: 0
};

function randSymbol() {
  return symbols[Math.floor(Math.random() * symbols.length)];
}

function spinOnce() {
  const out = [randSymbol(), randSymbol(), randSymbol()];
  els.reels.forEach((reel, i) => {
    reel.textContent = out[i];
  });
  return out;
}

function payoutMultiplier([a, b, c]) {
  if (a === b && b === c) return 5;
  if (a === b || b === c || a === c) return 2;
  return 0;
}

function render(msg = '') {
  els.credits.textContent = String(state.credits);
  els.highscore.textContent = String(state.highscore);
  els.streak.textContent = String(state.streak);
  if (msg) els.message.textContent = msg;
}

function reset() {
  state = { credits: 100, highscore: 100, streak: 0 };
  render('Run reset. Good luck!');
}

els.spinBtn.addEventListener('click', () => {
  const bet = Number(els.bet.value);
  if (!Number.isInteger(bet) || bet < 1 || bet > 25) {
    render('Bet must be a whole number between 1 and 25.');
    return;
  }

  if (state.credits < bet) {
    render('Not enough credits. Reset and try another run!');
    return;
  }

  state.credits -= bet;
  const roll = spinOnce();
  const multi = payoutMultiplier(roll);

  if (multi > 0) {
    const won = bet * multi;
    state.credits += won;
    state.streak += 1;
    state.highscore = Math.max(state.highscore, state.credits);
    render(`Nice! ${roll.join(' ')} paid x${multi} (+${won} credits).`);
  } else {
    state.streak = 0;
    render(`No match: ${roll.join(' ')}. Lost ${bet} credits.`);
  }

  if (state.credits <= 0) {
    render('Game over. You are out of credits. Reset to play again.');
  }
});

els.resetBtn.addEventListener('click', reset);
render();
