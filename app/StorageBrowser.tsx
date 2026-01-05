import { StorageBrowser } from '@aws-amplify/ui-react-storage';

// these should match access patterns defined in amplify/storage/resource.ts
const defaultPrefixes = ['public/'];

export default function Example() {
  return (
    <StorageBrowser defaultPrefixes={defaultPrefixes} />
  )
}