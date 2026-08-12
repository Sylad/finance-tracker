import { Test, TestingModule } from '@nestjs/testing';
import { HealthStatusController } from './health-status.controller';

describe('HealthStatusController', () => {
  let controller: HealthStatusController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthStatusController],
    }).compile();

    controller = module.get<HealthStatusController>(HealthStatusController);
  });

  it('GET /health retourne status:ok + timestamp', () => {
    const result = controller.check();
    expect(result).toHaveProperty('status', 'ok');
    expect(result).toHaveProperty('timestamp');
    expect(typeof result.timestamp).toBe('string');
    // Vérifier que timestamp est un ISO string valide
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
