import * as fs from 'fs';
import * as path from 'path';
import process from 'process';

try {
  await fs.promises.access(path.join('dist'));
  const result = await fs.promises.rmdir(path.join('dist'), { recursive: true });
  console.log('✅ Successfully deleted dist.');
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('No action required.');
  } else {
    console.error(`Unable to delete dist: ${error.message}`);
  }

}