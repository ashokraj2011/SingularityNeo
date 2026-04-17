import {
  publishBounty,
  publishBountySignal,
  waitForBountySignal
} from './server/eventBus.js';

async function verifySwarm() {
  console.log('Testing Swarm bounty system...');
  const bountyId = 'req-test-123';
  
  publishBounty({
    id: bountyId,
    capabilityId: 'cap-1',
    sourceAgentId: 'agent-1',
    targetRole: 'Backend',
    instructions: 'Test instructions',
    status: 'OPEN',
    createdAt: new Date().toISOString()
  });
  console.log('1. Bounty published.');

  // Async signal waiter
  const waitPromise = waitForBountySignal(bountyId, 5000);
  
  // Simulate another agent resolving it 1 sec later
  setTimeout(() => {
    console.log('2. Another agent is resolving the bounty...');
    publishBountySignal({
      bountyId,
      status: 'RESOLVED',
      resultSummary: 'Implemented the test backend route.',
      resolvedByAgentId: 'agent-2',
      resolvedAt: new Date().toISOString()
    });
  }, 1000);

  const result = await waitPromise;
  console.log('3. wait_for_signal resolved! Signal received:', result);
  
  if (result.status === 'RESOLVED' && result.resolvedByAgentId === 'agent-2') {
    console.log('SUCCESS: Swarm orchestration pub/sub works locally!');
  } else {
    throw new Error('Signal payload mismatch');
  }
}

verifySwarm().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
