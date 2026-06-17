import { registerRootComponent } from 'expo';
import { registerGlobals } from '@livekit/react-native';
import App from './apps/mobile/src/App';

registerGlobals();
registerRootComponent(App);
