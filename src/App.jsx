import { useState } from 'react';
import TourMode from './components/TourMode';
import ExploreMap from './components/ExploreMap';

export default function App() {
  const [tourActive, setTourActive] = useState(false);

  if (tourActive) {
    return <TourMode onExit={() => setTourActive(false)} />;
  }

  return (
    <div className="relative w-full h-full">
      <ExploreMap onStartTour={() => setTourActive(true)} />
    </div>
  );
}
