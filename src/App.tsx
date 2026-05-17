import { useReducer, useState } from 'react';
import { makeFullInitial, reducer } from './game/reducer';
import { TitleScreen } from './ui/TitleScreen';
import { GameScreen } from './ui/GameScreen';
import { EventModal } from './ui/EventModal';
import { CopFightScreen } from './ui/CopFightScreen';
import { GameOverScreen } from './ui/GameOverScreen';
import { LeaderboardScreen } from './ui/LeaderboardScreen';

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => makeFullInitial(30));
  const [titleLeaderboard, setTitleLeaderboard] = useState(false);

  const onStart = (mode: import('./game/state').GameMode, days: number) => {
    dispatch({ type: 'NEW_GAME', totalDays: days, mode });
    dispatch({ type: 'START_GAME' });
  };

  let body: React.ReactNode;
  if (titleLeaderboard) {
    body = <LeaderboardScreen onBack={() => setTitleLeaderboard(false)} />;
  } else if (state.phase === 'title') {
    body = <TitleScreen onStart={onStart} onLeaderboard={() => setTitleLeaderboard(true)} />;
  } else if (state.phase === 'game_over') {
    body = <GameOverScreen state={state} dispatch={dispatch} />;
  } else if (state.phase === 'leaderboard') {
    body = <LeaderboardScreen onBack={() => dispatch({ type: 'BACK_TO_TITLE' })} />;
  } else {
    body = <GameScreen state={state} dispatch={dispatch} />;
  }

  return (
    <div className="scanlines h-full w-full overflow-hidden">
      {body}
      {state.phase === 'event' && <EventModal state={state} dispatch={dispatch} />}
      {state.phase === 'fighting_cops' && <CopFightScreen state={state} dispatch={dispatch} />}
    </div>
  );
}
