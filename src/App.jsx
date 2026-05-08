import { useState } from 'react';
import TourMode from './components/TourMode';
import ExploreMap from './components/ExploreMap';

export default function App() {
  const [tourProperty, setTourProperty] = useState(null);

  if (tourProperty) {
    return <TourMode property={tourProperty} onExit={() => setTourProperty(null)} />;
  }

  return (
    <div className="relative w-full h-full">
      <ExploreMap onStartTour={setTourProperty} />
    </div>
  );
}
